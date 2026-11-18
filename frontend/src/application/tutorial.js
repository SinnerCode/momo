/* 教程入口只管理学习界面，安装状态由聚合只读接口提供。 */
import { writeShell } from '../shell/index';
import { peachHistory, shellNavigate } from '../history/index';
import { openGuide } from '../onboarding/guide-state';
import { applicationEffects } from './effects';

export async function reopenPostSetupTutorial() { openGuide({ reopen: true }) }

export function installTutorial8() {
  const clean = new URL(location.href);
  const fromSetup = clean.searchParams.get('onboarding') === '1';
  writeShell({ cameFromSetup: fromSetup });
  applicationEffects.handler(document.getElementById('tutorialBtn'), 'onclick', () => openGuide());
  openGuide({ invitation: true });
  if (fromSetup) clean.searchParams.delete('onboarding');
  const flag = clean.searchParams.get('agentation');
  try { localStorage.removeItem('peach.agentation') } catch { /* 禁用本地存储时保留页面功能。 */ }
  if (flag !== null) clean.searchParams.delete('agentation');
  if (clean.href !== location.href) shellNavigate(clean, { replace: true, state: peachHistory.navigation.location.state });
  if (flag === 'on') import('/dev/agentation.js').catch(() => {});
}
