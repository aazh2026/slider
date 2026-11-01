#!/usr/bin/env bun
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 模型端点替身（独立进程）—— 见 model-stub.ts 里的说明
 *
 * 单独跑成一个进程，是因为调用方（mutation-check / repro / all.ts）在等测试结果时
 * 是**同步阻塞**的 —— 替身要是跑在同一个进程里，它的 HTTP 服务就没机会应答，
 * 后端的请求会一直挂到超时。这不是替身的问题，是"被同步阻塞的进程没法服务别人"。
 *
 * 端口通过 stdout 的 `PORT=<n>` 交给调用方。
 */

const INVALID_KEY_BODY = {
  error: {
    code: 400,
    message: 'API key not valid. Please pass a valid API key.',
    status: 'INVALID_ARGUMENT',
  },
};

export {};

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch(req) {
    // 把请求读掉 —— 不读的话客户端可能一直在等 body
    await req.arrayBuffer().catch(() => undefined);
    return new Response(JSON.stringify(INVALID_KEY_BODY), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  },
});

const port = server.port;
if (typeof port !== 'number') {
  console.error('模型替身拿不到端口 —— Bun.serve 没返回 port');
  process.exit(1);
}

// 用 Bun.write 直写 stdout —— console.log 走管道时可能被缓冲，
// 调用方会一直等不到端口。
await Bun.write(Bun.stdout, `PORT=${port}\n`);

// 收到 SIGTERM 就干净退出
process.on('SIGTERM', () => {
  void server.stop().then(() => process.exit(0));
});
