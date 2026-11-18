"""女优影片删除的范围复核、文件失败和事务回滚。"""
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from support.ledger import fresh_ledger
from peach.web_performer_delete import q_performer_delete_candidates, q_performer_delete_plan, w_performer_delete
from peach.web_state import WebContract
from peach import task_control


class PerformerDeleteTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.contract = WebContract(fresh_ledger(self.root), avatar_root=self.root / 'avatars')
        self.contract.resource_cleanup_enabled = False
        roots = mock.patch('peach.web_batch.LOCATION_ROOT_DECLARATIONS', {'local': (str(self.root),)})
        roots.start()
        self.addCleanup(roots.stop)
        with self.contract.write_transaction() as c:
            for entity_id, kind in ((1, 'performer'), (2, 'performer'), (3, 'studio')):
                c.execute("INSERT INTO entity(id,kind,canonical_name,normalized_name,created_at,updated_at) "
                          "VALUES(?,?,?,?, '2026-01-01','2026-01-01')", (entity_id, kind, f'人物{entity_id}', f'人物{entity_id}'))

    def add(self, asset_id, entity_id=1, medium='video', disposal=None):
        path = self.root / f'{asset_id}.mp4'
        path.write_bytes(b'temporary media')
        with self.contract.write_transaction() as c:
            c.execute('INSERT INTO asset(id,location,path,medium,disposal,size) VALUES(?,?,?,?,?,?)',
                      (asset_id, 'local', str(path), medium, disposal, path.stat().st_size))
            c.execute("INSERT INTO asset_entity(asset_id,entity_id,role,source) VALUES(?,?,'performer','user:manual')",
                      (asset_id, entity_id))
        return path

    def plan(self, ids='1'):
        return q_performer_delete_plan(self.contract, {'ids': ids})

    def delete(self, plan):
        return w_performer_delete(self.contract, {'entity_ids': plan['entity_ids'], 'plan': plan['plan']})

    def test_plan_includes_all_video_states_and_shared_files_but_not_photos_or_other_people(self):
        self.add(1)
        self.add(2, disposal='trash')
        self.add(3, medium='image')
        self.add(4, entity_id=2)
        with self.contract.write_transaction() as c:
            c.execute("INSERT INTO asset_entity(asset_id,entity_id,role,source) VALUES(1,2,'performer','user:manual')")
        plan = self.plan()
        self.assertEqual([r['id'] for r in plan['items']], [1, 2])
        self.assertEqual(plan['shared'], 1)
        self.assertTrue((self.root / '1.mp4').exists())

    def test_changed_selection_is_rejected_before_touching_any_media(self):
        first = self.add(1)
        plan = self.plan()
        second = self.add(2)
        with self.assertRaisesRegex(ValueError, '清单已变化'):
            self.delete(plan)
        self.assertTrue(first.exists())
        self.assertTrue(second.exists())

    def test_cancel_before_deletion_keeps_media_and_records_cancelled(self):
        path = self.add(1)
        plan = self.plan()
        start = self.contract.task_runs.start

        def cancel_started(*args, **kwargs):
            run = start(*args, **kwargs)
            task_control.request(self.contract.task_runs, run.id, 'cancel')
            return run

        with mock.patch.object(self.contract.task_runs, 'start', side_effect=cancel_started):
            with self.assertRaises(task_control.Cancelled):
                self.delete(plan)
        self.assertTrue(path.exists())
        self.assertEqual(self.plan()['total'], 1)
        self.assertEqual(self.contract.task_runs.query(limit=1)[0].status, 'cancelled')

    def test_more_than_200_files_delete_together_and_keep_profile_photos_and_unrelated_media(self):
        for asset_id in range(1, 202):
            self.add(asset_id)
        photo = self.add(202, medium='image')
        other = self.add(203, entity_id=2)
        result = self.delete(self.plan())
        self.assertEqual(result['purged'], 201)
        self.assertEqual(result['blocked'], [])
        self.assertFalse((self.root / '1.mp4').exists())
        self.assertTrue(photo.exists())
        self.assertTrue(other.exists())
        with self.contract.read_connection() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM entity WHERE id=1').fetchone()[0], 1)
            self.assertEqual([r[0] for r in c.execute('SELECT id FROM asset ORDER BY id')], [202, 203])
            self.assertEqual(c.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_file_failure_preserves_its_ledger_row_and_reports_the_reason(self):
        path = self.add(1)
        with mock.patch('peach.web_batch._quarantine_media', side_effect=PermissionError('file locked')):
            result = self.delete(self.plan())
        self.assertEqual(result['purged'], 0)
        self.assertEqual(result['blocked'][0]['id'], 1)
        self.assertIn('file locked', result['blocked'][0]['reason'])
        self.assertTrue(path.exists())
        self.assertEqual(self.plan()['total'], 1)

    def test_database_failure_restores_quarantined_media_and_ledger(self):
        path = self.add(1)
        with self.contract.write_transaction() as c:
            c.execute("CREATE TRIGGER reject_delete BEFORE DELETE ON asset BEGIN SELECT RAISE(ABORT,'blocked delete'); END")
        with self.assertRaisesRegex(Exception, 'blocked delete'):
            self.delete(self.plan())
        self.assertTrue(path.exists())
        self.assertEqual(self.plan()['total'], 1)

    def test_wrong_kind_invalid_id_and_missing_plan_are_rejected(self):
        for value in ('', '0', '-1', '1 OR 1=1', True, '3'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                q_performer_delete_plan(self.contract, {'ids': value})
        with self.assertRaises(ValueError):
            w_performer_delete(self.contract, {'entity_ids': [1]})

    def test_selected_performers_share_one_deduplicated_deletion_plan(self):
        self.add(1)
        self.add(2, entity_id=2)
        self.add(3, medium='image')
        with self.contract.write_transaction() as c:
            c.execute("INSERT INTO asset_entity(asset_id,entity_id,role,source) VALUES(1,2,'performer','user:manual')")
        plan = self.plan('2,1,2')
        self.assertEqual(plan['entity_ids'], [1, 2])
        self.assertEqual([row['id'] for row in plan['items']], [1, 2])
        self.assertEqual(plan['shared'], 0)
        result = self.delete(plan)
        self.assertEqual(result['purged'], 2)
        self.assertTrue((self.root / '3.mp4').is_file())

    def test_candidate_table_counts_files_once_per_person_and_keeps_trash_only_performers(self):
        self.add(1)
        self.add(2, disposal='trash')
        self.add(3, entity_id=2, disposal='trash')
        self.add(4, medium='image')
        with self.contract.write_transaction() as c:
            c.execute("UPDATE asset SET code='CODE-1' WHERE id IN (1,2)")
            c.execute("INSERT INTO asset_entity(asset_id,entity_id,role,source) VALUES(1,1,'performer','auto:metadata')")
        rows = {row['entity_id']: row for row in q_performer_delete_candidates(self.contract, {})['items']}
        self.assertEqual(set(rows), {1, 2})
        self.assertEqual((rows[1]['n'], rows[1]['file_count']), (1, 2))
        self.assertEqual(rows[1]['bytes'], 2 * len(b'temporary media'))
        self.assertEqual(rows[2]['file_count'], 1)
