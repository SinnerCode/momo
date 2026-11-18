"""教程状态随账本共享，提示版本独立于应用升级。"""
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from peach import web_tutorial
from peach.web_contract import WebContract, dispatch_api_get, dispatch_api_post


class TutorialProgressTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name).resolve() / 'ledger.db'
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.executescript("""
                CREATE TABLE profile(id TEXT PRIMARY KEY,settings_json TEXT,updated_at TEXT);
                INSERT INTO profile VALUES('local-default','{"sidebarOrder":["tags"]}','');
            """)
        self.desktop = WebContract(self.path)
        self.phone = WebContract(self.path)

    def read(self, device=None):
        return dispatch_api_get(device or self.desktop, '/api/tutorial-progress', {})

    def write(self, action, device=None, **values):
        return dispatch_api_post(device or self.desktop, '/api/tutorial-progress',
                                 {'campaign': web_tutorial.CAMPAIGN, 'action': action, **values})

    def test_devices_share_dismissal_completion_and_reopen_without_erasing_read_steps(self):
        self.assertFalse(self.read(self.phone)['invited'])
        self.write('dismiss')
        self.assertTrue(self.read(self.phone)['invited'])
        self.write('step', chapter='basics', step='search', next=2, skipped=False)
        self.write('complete')
        self.assertTrue(self.read(self.phone)['completed'])
        self.write('reopen', self.phone)
        reopened = self.read()
        self.assertFalse(reopened['completed'])
        self.assertTrue(reopened['invited'])
        self.assertEqual(reopened['chapters']['basics']['read'], ['search'])
        with closing(sqlite3.connect(self.path)) as connection:
            stored = json.loads(connection.execute('SELECT settings_json FROM profile').fetchone()[0])
        self.assertEqual(stored['sidebarOrder'], ['tags'])

    def test_interleaved_devices_update_only_their_step_and_keep_completion(self):
        self.write('step', chapter='basics', step='search', next=2, skipped=False)
        self.write('step', self.phone, chapter='library', step='folders', next=1, skipped=True)
        self.write('step', self.phone, chapter='basics', step='cards', next=3, skipped=False)
        self.write('complete')
        self.write('position', self.phone, chapter='library', next=0)
        state = self.read()
        self.assertEqual(state['chapters']['basics']['read'], ['search', 'cards'])
        self.assertEqual(state['chapters']['library']['skipped'], ['folders'])
        self.assertTrue(state['completed'])
        self.write('step', chapter='library', step='folders', next=1, skipped=False)
        self.assertEqual(self.read()['chapters']['library']['skipped'], [])

    def test_new_process_keeps_state_and_only_explicit_campaign_change_reinvites(self):
        self.write('step', chapter='basics', step='search', next=2, skipped=False)
        self.write('complete')
        self.assertTrue(self.read(WebContract(self.path))['completed'])
        previous_campaign = web_tutorial.CAMPAIGN
        with patch.object(web_tutorial, 'CAMPAIGN', 'new-guide-2'):
            state = self.read(self.phone)
            self.assertFalse(state['completed'])
            self.assertFalse(state['invited'])
            self.assertEqual(state['chapters']['basics']['read'], ['search'])
            with self.assertRaises(ValueError):
                dispatch_api_post(self.desktop, '/api/tutorial-progress',
                                  {'campaign': previous_campaign, 'action': 'dismiss'})
            self.write('dismiss', self.phone)
            self.assertTrue(self.read()['invited'])

    def test_tutorial_center_release_reinvites_existing_users_and_retains_read_progress(self):
        for action in ('dismiss', 'complete'):
            with self.subTest(previous_action=action):
                with patch.object(web_tutorial, 'CAMPAIGN', 'welcome-1'):
                    self.write('step', chapter='basics', step='search', next=1, skipped=False)
                    self.write(action)
                upgraded = self.read(self.phone)
                self.assertFalse(upgraded['invited'])
                self.assertFalse(upgraded['completed'])
                self.assertEqual(upgraded['chapters']['basics']['read'], ['search'])
                self.write('dismiss', self.phone)
                self.assertTrue(self.read(WebContract(self.path))['invited'])

    def test_invalid_writes_do_not_change_existing_state(self):
        original = self.read()
        for values in ({'action': 'unknown'},
                       {'action': 'position', 'chapter': '../oops', 'next': 0},
                       {'action': 'position', 'chapter': 'basics', 'next': True},
                       {'action': 'step', 'chapter': 'basics', 'next': 1, 'step': 'search', 'skipped': 'yes'}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                dispatch_api_post(self.desktop, '/api/tutorial-progress',
                                  {'campaign': web_tutorial.CAMPAIGN, **values})
        self.assertEqual(self.read(), original)
