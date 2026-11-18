let active = false;

/** 导览只展示真实播放器控件，不修改持久偏好或读取视频正片。 */
export const isPlayerGuidePreview = () => active;
export function beginPlayerGuidePreview(): () => void {
  active = true;
  return () => { active = false };
}
