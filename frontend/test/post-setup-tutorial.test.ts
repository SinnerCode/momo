/* 学习进度来自本机账本，导览会话独立于安装状态。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProgress, guideChapterComplete, guideResumePosition, listenGuide, openGuide, readGuideProgress, recordGuideStep, saveGuideProgress } from '../src/onboarding/guide-state';
import { createGuideSession, findGuideTarget, resolveGuideTarget } from '../src/onboarding/guide-driver';
import { GUIDE_CHAPTERS, GUIDE_TOPICS } from '../src/onboarding/guide-catalog';
import { guideEntry } from '../src/onboarding/guide-entry';
import { isPlayerGuidePreview } from '../src/player/guide-preview';

const mocks = vi.hoisted(() => ({ driver: vi.fn(), unlisten: vi.fn(), listen: vi.fn(), popover: vi.fn(() => vi.fn()), disposeStage: vi.fn() }));
vi.mock('driver.js', () => ({ driver: mocks.driver }));
vi.mock('../src/history', () => ({ peachHistory: { listen: mocks.listen } }));
vi.mock('../src/application/layout', () => ({ closeDrawerAfterNav: vi.fn() }));
vi.mock('../src/application/media', () => ({ disposeStage: mocks.disposeStage }));
beforeEach(() => {
  localStorage.clear();
  mocks.driver.mockReset(); mocks.unlisten.mockReset();
  mocks.popover.mockClear();
  mocks.disposeStage.mockClear();
  mocks.listen.mockReset().mockReturnValue(mocks.unlisten);
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren();
});

describe('章节进度', () => {
  it('到达末尾不代表完成，缺失步骤从未读位置继续，全部已读才可重看', () => {
    const chapter = GUIDE_CHAPTERS.find(item => item.id === 'basics')!;
    let progress = emptyProgress();
    chapter.steps.forEach((step, index) => { progress = recordGuideStep(progress, chapter.id, step.id, index + 1, index === 1) });
    expect(guideChapterComplete(progress, chapter)).toBe(false);
    expect(guideResumePosition(progress, chapter)).toBe(1);
    progress = recordGuideStep(progress, chapter.id, chapter.steps[1]!.id, 2, false);
    expect(guideChapterComplete(progress, chapter)).toBe(true);
    expect(guideResumePosition(progress, chapter)).toBe(0);
  });
  it('换页步骤给出真实操作路径，设置与数据管理保留必要层级', () => {
    for (const chapter of GUIDE_CHAPTERS) for (const step of chapter.steps) {
      if (step.route) expect(guideEntry(step)?.path.length, `${chapter.id}/${step.id}`).toBeGreaterThan(1);
    }
    const entry = (route: '/review' | '/quality-goals' | '/settings/network' | '/settings/appearance') => guideEntry({ id: 'entry', title: '', body: '', route })?.path;
    expect(entry('/review')).toEqual(['侧栏', '管理', '数据管理', '人工复核']);
    expect(entry('/quality-goals')).toEqual(['侧栏', '管理', '数据管理', '高清版']);
    expect(entry('/settings/network')).toEqual(['侧栏底部的设置', 'Peach 配置', '网络与访问']);
    expect(entry('/settings/appearance')).toEqual(['侧栏底部的设置', '外观与导航']);
  });
  it('快速导览在首页四步结束，详细章节都可以从主题目录找到', () => {
    const quick = GUIDE_CHAPTERS.find(chapter => chapter.id === 'basics')!;
    expect(quick.steps).toHaveLength(4);
    expect(quick.steps.every(step => step.route === '/')).toBe(true);
    for (const kind of ['interface', 'settings'] as const) {
      const topics = GUIDE_TOPICS.filter(topic => topic.kind === kind);
      expect(topics).toHaveLength(4);
      const covered = topics.flatMap(topic => topic.chapters);
      expect(new Set(covered).size).toBe(covered.length);
      expect([...covered].sort()).toEqual(GUIDE_CHAPTERS.filter(chapter => chapter.kind === kind && chapter.id !== 'basics').map(chapter => chapter.id).sort());
    }
  });
  it('未开始时没有章节完成记录', () => {
    expect(emptyProgress()).toEqual({ version: 1, campaign: '', invited: false, completed: false, chapters: {} });
  });
  it('已读与跳过互斥，重看不重复计数，其他章节保持原状', () => {
    const original = recordGuideStep(emptyProgress(), 'settings', 'network', 1, false);
    const skipped = recordGuideStep(original, 'basics', 'search', 1, true);
    expect(skipped.chapters.basics).toEqual({ next: 1, read: [], skipped: ['search'] });
    const read = recordGuideStep(skipped, 'basics', 'search', 1, false);
    const reread = recordGuideStep(read, 'basics', 'search', 1, false);
    expect(reread.chapters.basics).toEqual({ next: 1, read: ['search'], skipped: [] });
    expect(reread.chapters.settings).toEqual(original.chapters.settings);
    expect(original.chapters.basics).toBeUndefined();
    expect(recordGuideStep(read, 'basics', 'search', 1, true).chapters.basics!.read).toEqual([]);
  });
  it('换页后仍读取账本进度，不采用旧浏览器进度', async () => {
    const saved = { ...recordGuideStep(emptyProgress(), 'basics', 'search', 1, false), campaign: 'welcome-1', invited: true };
    localStorage.setItem('peach.guides.v1', JSON.stringify(emptyProgress()));
    const fetcher = vi.fn(async () => new Response(JSON.stringify(saved), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    for (const path of ['/', '/settings/library', '/taste']) {
      history.replaceState({}, '', path); expect(await readGuideProgress()).toEqual(saved);
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('读取或保存失败向调用方报告，不当成空进度或写入成功', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: '服务不可用' }), { status: 503 })));
    await expect(readGuideProgress()).rejects.toThrow();
    await expect(saveGuideProgress('welcome-1', { action: 'dismiss' })).rejects.toThrow();
  });
  it('保存只发送当前动作，不用本设备快照覆盖其他设备的章节', async () => {
    const done = { ...emptyProgress(), campaign: 'welcome-1', invited: true, completed: true };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(done), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    expect(await saveGuideProgress('welcome-1', { action: 'complete' })).toEqual(done);
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ campaign: 'welcome-1', action: 'complete' });
  });
  it('重开只通知入口，不重置学习或安装状态，不发送请求', () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    localStorage.setItem('peach.post-setup-tutorial.v1', 'complete');
    const listener = vi.fn(), close = listenGuide(listener);
    try {
      openGuide(); openGuide({ chapter: 'basics' });
      expect(listener.mock.calls).toEqual([[{}], [{ chapter: 'basics' }]]);
      expect(localStorage.getItem('peach.post-setup-tutorial.v1')).toBe('complete');
      expect(fetcher).not.toHaveBeenCalled();
    } finally { close() }
  });
  it('挂载前的请求交付一次，卸载后的入口不接收排队请求', async () => {
    openGuide({ chapter: 'settings' });
    const listener = vi.fn(), close = listenGuide(listener);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledExactlyOnceWith({ chapter: 'settings' }); close();
    const later = vi.fn(), unsubscribe = listenGuide(later);
    await Promise.resolve(); expect(later).not.toHaveBeenCalled(); unsubscribe();
    openGuide({ invitation: true });
    const discarded = vi.fn(); listenGuide(discarded)();
    await Promise.resolve(); expect(discarded).not.toHaveBeenCalled();
  });
});

describe('只读导览会话', () => {
  const step = { id: 'search', title: '搜索馆藏', body: '输入关键词。', target: '#guide-target' };
  const callbacks = () => ({ mountPopover: mocks.popover, navigate: vi.fn(), next: vi.fn(), previous: vi.fn(), close: vi.fn() });
  const visibleTarget = () => {
    const target = document.createElement('button'); target.id = 'guide-target'; document.body.append(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ width: 100, height: 40 }));
    return target;
  };
  it('首次邀请框选教程按钮并保留入口的键盘操作，遮罩可关闭', async () => {
    const entry = visibleTarget(); entry.id = 'tutorialBtn';
    const instance = { destroy: vi.fn(), highlight: vi.fn(), refresh: vi.fn() };
    mocks.driver.mockReturnValue(instance);
    const actions = callbacks(), session = createGuideSession({ ...actions, invitation: true });
    try {
      await session.show({ id: 'tutorial-entry', title: '打开教程', body: '认识入口', target: '#tutorialBtn' }, 0, 1);
      expect(instance.highlight.mock.calls[0]![0].element).toBe(entry);
      expect(mocks.driver.mock.calls[0]![0].disableActiveInteraction).toBe(false);
      const panel = document.createElement('div'); panel.className = 'peach-guide-popover'; document.body.append(panel);
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      entry.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      mocks.driver.mock.calls[0]![0].overlayClickBehavior();
      expect(actions.close).toHaveBeenCalledOnce();
      expect(actions.next).not.toHaveBeenCalled();
    } finally { session.stop() }
  });

  it('从馆藏打开真实详情，结束后释放临时播放模式且不保留小窗', async () => {
    history.replaceState({}, '', '/taste');
    const target = visibleTarget(); target.dataset.guideVideo = ''; target.dataset.id = '42';
    mocks.driver.mockReturnValue({ destroy: vi.fn(), highlight: vi.fn(), refresh: vi.fn() });
    const actions = callbacks();
    actions.navigate.mockImplementation(path => history.replaceState({}, '', path));
    const session = createGuideSession(actions);
    try {
      await session.show({ ...step, route: '/', surface: 'player' }, 0, 1);
      expect(actions.navigate.mock.calls.map(call => call[0])).toEqual(['/', '/assets/42']);
      expect(isPlayerGuidePreview()).toBe(true);
    } finally { session.stop() }
    expect(isPlayerGuidePreview()).toBe(false);
    expect(mocks.disposeStage).toHaveBeenCalledExactlyOnceWith(false, false, { miniplayer: false });
  });
  it('缺失目标有等待期限，取消等待后没有遗留计时器', async () => {
    vi.useFakeTimers(); const controller = new AbortController();
    const timed = findGuideTarget('#missing', controller.signal, 160);
    await vi.advanceTimersByTimeAsync(160); expect(await timed).toBeUndefined();
    const cancelled = findGuideTarget('#missing', controller.signal); controller.abort();
    await vi.advanceTimersByTimeAsync(80); expect(await cancelled).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('骨架或 inert 区域不作为目标，显示后可定位', async () => {
    const target = visibleTarget(); target.setAttribute('inert', '');
    expect(await findGuideTarget('#guide-target', new AbortController().signal, 0)).toBeUndefined();
    target.removeAttribute('inert'); target.setAttribute('data-skeleton', '');
    expect(await findGuideTarget('#guide-target', new AbortController().signal, 0)).toBeUndefined();
    target.removeAttribute('data-skeleton');
    expect(await findGuideTarget('#guide-target', new AbortController().signal, 0)).toBe(target);
  });
  it('收起的搜索框和移出屏幕的侧栏让位给可见入口', async () => {
    const hidden = visibleTarget(); hidden.style.opacity = '0';
    const fallback = document.createElement('button'); fallback.id = 'fallback'; document.body.append(fallback);
    vi.spyOn(fallback, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 20, width: 40, height: 40 }));
    expect(await findGuideTarget('#guide-target,#fallback', new AbortController().signal, 0)).toBe(fallback);
    hidden.style.opacity = '1';
    vi.mocked(hidden.getBoundingClientRect).mockReturnValue(DOMRect.fromRect({ x: -110, width: 100, height: 40 }));
    expect(await findGuideTarget('#guide-target,#fallback', new AbortController().signal, 0)).toBe(fallback);
  });
  it('说明只定位与导航，不点击业务控件或发送请求', async () => {
    const target = visibleTarget(), clicked = vi.fn(), fetcher = vi.fn();
    target.addEventListener('click', clicked); vi.stubGlobal('fetch', fetcher);
    const instance = { destroy: vi.fn(), highlight: vi.fn(), refresh: vi.fn(), isActive: () => true };
    mocks.driver.mockReturnValue(instance);
    const actions = callbacks(), session = createGuideSession(actions);
    try {
      await session.show({ ...step, route: '/tasks', title: '<搜索>', body: 'A & B' }, 0, 2);
      expect(actions.navigate).toHaveBeenCalledWith('/tasks');
      expect(mocks.driver).toHaveBeenCalledWith(expect.objectContaining({ disableActiveInteraction: true, allowKeyboardControl: false }));
      expect(instance.highlight.mock.calls[0]![0]).toMatchObject({ element: target, popover: { side: 'bottom' } });
      mocks.driver.mock.calls[0]![0].onPopoverRender({ wrapper: document.createElement('div'), arrow: document.createElement('div') });
      expect(mocks.popover).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ step: expect.objectContaining({ title: '<搜索>', body: 'A & B' }), missing: false }));
      mocks.driver.mock.calls[0]![0].onNextClick(); expect(actions.next).toHaveBeenCalledWith(false);
      mocks.driver.mock.calls[0]![0].overlayClickBehavior(); expect(actions.close).toHaveBeenCalledOnce();
      expect(clicked).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    } finally { session.stop() }
    expect(instance.destroy).toHaveBeenCalledOnce(); expect(mocks.unlisten).toHaveBeenCalledOnce();
  });
  it('结束正在等待目标的会话后不会产生浮层', async () => {
    vi.useFakeTimers(); const session = createGuideSession(callbacks());
    const showing = session.show(step, 0, 2); session.stop();
    await vi.advanceTimersByTimeAsync(80); await showing;
    expect(mocks.driver).not.toHaveBeenCalled(); expect(mocks.unlisten).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('原位改字中的 Escape 留给编辑器取消，不退出导览', () => {
    const actions = callbacks(), session = createGuideSession(actions);
    const input = document.createElement('span'); input.dataset.copyInline = ''; document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(actions.close).not.toHaveBeenCalled(); session.stop();
  });
  it('目标仍在等待时 Escape 与外部导航都能结束会话', async () => {
    vi.useFakeTimers();
    for (const cancel of ['escape', 'navigate']) {
      const actions = callbacks(), session = createGuideSession(actions);
      const showing = session.show(step, 0, 2);
      if (cancel === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      else mocks.listen.mock.calls.at(-1)![0]();
      expect(actions.close).toHaveBeenCalledOnce();
      session.stop(); await vi.advanceTimersByTimeAsync(80); await showing;
    }
    expect(mocks.driver).not.toHaveBeenCalled();
  });
  it('缺失目标可继续阅读，下一步记录为跳过', async () => {
    vi.useFakeTimers();
    const instance = { destroy: vi.fn(), highlight: vi.fn(), refresh: vi.fn(), isActive: () => true }; mocks.driver.mockReturnValue(instance);
    const actions = callbacks(), session = createGuideSession(actions);
    try {
      const showing = session.show(step, 0, 2); await vi.advanceTimersByTimeAsync(4000); await showing;
      expect(instance.highlight.mock.calls[0]![0].element).toBeUndefined();
      mocks.driver.mock.calls[0]![0].onPopoverRender({ wrapper: document.createElement('div'), arrow: document.createElement('div') });
      expect(mocks.popover).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ missing: true }));
      mocks.driver.mock.calls[0]![0].onNextClick(); expect(actions.next).toHaveBeenCalledWith(true);
    } finally { session.stop() }
  });
  it('框选设置标签和控件所在整行，不只框选开关', () => {
    const row = document.createElement('label'); row.setAttribute('data-setting-row', ''); document.body.append(row);
    const target = visibleTarget(); row.append(target);
    expect(resolveGuideTarget('#guide-target')).toBe(row);
  });
  it('内部滚动、窗口变化和目标重挂载后刷新位置，结束时清理跟踪', async () => {
    let frame: FrameRequestCallback | undefined;
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1 }));
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const target = visibleTarget();
    const instance = { destroy: vi.fn(), highlight: vi.fn(), refresh: vi.fn() }; mocks.driver.mockReturnValue(instance);
    const session = createGuideSession(callbacks());
    await session.show(step, 0, 2);
    frame!(0); instance.refresh.mockClear();
    vi.mocked(target.getBoundingClientRect).mockReturnValue(DOMRect.fromRect({ y: 120, width: 100, height: 40 }));
    document.dispatchEvent(new Event('scroll')); frame!(16);
    expect(instance.refresh).toHaveBeenCalledOnce();
    instance.refresh.mockClear(); vi.stubGlobal('innerWidth', 390); frame!(32);
    expect(instance.refresh).toHaveBeenCalledOnce();
    target.remove(); const replacement = visibleTarget(); frame!(48);
    expect(instance.highlight.mock.calls.at(-1)![0].element).toBe(replacement);
    replacement.remove(); frame!(64);
    expect(instance.highlight.mock.calls.at(-1)![0].element).toBeUndefined();
    session.stop(); expect(cancel).toHaveBeenCalled();
    instance.refresh.mockClear(); frame!(80); expect(instance.refresh).not.toHaveBeenCalled();
  });
});
