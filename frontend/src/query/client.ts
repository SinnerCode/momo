/* 全站唯一的 TanStack Query 客户端（ADR-0031）。
 * @peach/query 直接解析到共享源码，Application 的 fetchQuery、页面 prefetch 与 Providers 使用同一实例。
 * 首屏预取与组件读取同一缓存，避免挂载后重复请求或写入只更新部分读者。 */
import { QueryClient } from '@tanstack/query-core';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /* 同一浏览器标签页保留已访问内容；主动刷新和写操作失效仍会取新数据。 */
      gcTime: Infinity,
      /* 请求都打本机的 `/api/...`。浏览器的 online 标记说的是外网，断了外网它就翻 false，
         Query 默认会把本机请求也挂起成 paused——页面于是停在旧数据上，什么都不说。 */
      networkMode: 'always',
      /* 不重试。失败的原因是服务没起、数据库只读或者迁移还没跑，同一秒里再问三遍得到的是
         同一句话，只把它推迟几秒显示；真正的重试是页面自己的轮询，下一轮就到。 */
      retry: 0,
      /* 焦点回来不自动重取：需要新数据的页面自己按内容定轮询节律（活动页是 2 秒／10 秒），
         再加一条焦点触发就是同一份数据两个节律。对外来源的采集与追更一律显式触发，
         更不能因为切回标签页就发出去。要即时刷新的页面自己在 `useQuery` 里打开。 */
      refetchOnWindowFocus: false,
      /* 初次进入先预取，栏目往返复用缓存。挂载只重取被写操作失效的查询，不重复正常读取；
         失败保持错误回执，由页面自己的重试入口处理。 */
      refetchOnMount: query => query.state.isInvalidated,
      retryOnMount: false,
    },
  },
});
