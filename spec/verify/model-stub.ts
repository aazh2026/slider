/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 模型端点替身 —— 让 E2E 离线跑
 * ---------------------------------------------------------------------------
 * 为什么需要它：
 *
 *   docs/testing-strategy.md §6.1 明写「**默认离线**：`bun test` 一律使用回放，
 *   不烧 API 额度」，docs/backend-design.md §13 的测试分层里也把
 *   「AI 离线 → 录制响应回放」列为独立一层。
 *
 *   但 E2E 之前是**直连官方 Gemini**的（`.env` 里放的是占位 key）。
 *   于是每一次 E2E 的结论都取决于**外网当时的状态**：
 *   实测同一台机器上，官方端点既有 300ms 返回 400 的常态，
 *   也有 TLS 校验失败、以及**整整 20 秒连不上**（触发超时重试，
 *   3 次重试 = 60s）的时刻。
 *
 *   E2E 里「生成大纲」那一步只等 60s —— 而降级链的最坏耗时正好是
 *   3 × 20s = 60s。**测试的等待上限等于被测实现的最坏值**，
 *   于是这条用例变成掷硬币：外网抖一下，判据就"失败"了。
 *
 *   这不是测试不稳，是**证据不稳** —— 一次失败的判据分不清是实现坏了
 *   还是外网抽风。E2E 的产出是追溯矩阵里的证据，证据不能有这种歧义。
 *
 * ---------------------------------------------------------------------------
 * 这个替身返回什么
 *
 *   官方端点拿到占位 key 时的**真实**响应（已从 `model_calls` 留痕里核对过）：
 *
 *     HTTP 400
 *     {"error":{"code":400,"message":"API key not valid. Please pass a valid API key.",
 *               "status":"INVALID_ARGUMENT"}}
 *
 *   原样照抄 —— 于是 E2E 走的是**同一条真实链路**：
 *   真 HTTP → 真 SDK → 真错误分类（400 不可重试）→ 真降级链 → 真本地生成。
 *   被换掉的只有链路尽头那台机器。
 *
 *   为什么不让它"成功"：E2E 断言的是前后端**集成**，
 *   不是 AI 的生成质量 —— 那是 `apps/api/tests/ai/` 用 FakeModelClient 覆盖的。
 *   E2E 需要的是一条**确定的**失败路径（模型不可用 → 降级），
 *   而 docs/backend-design.md §6.1 的降级链本来就是必测路径。
 */

export interface ModelStubHandle {
  /** 端点地址 —— 传给后端的 GEMINI_BASE_URL */
  baseUrl: string;
  /** 关掉它 */
  stop: () => Promise<void>;
}

/**
 * 起一个模型端点替身（**独立进程**）。
 *
 * **为什么必须是独立进程**：调用方（mutation-check / repro / all.ts）在等 E2E 结果时
 * 用的是 `Bun.spawnSync` —— 那是**同步阻塞**的，整个进程的 JS 事件循环都停着。
 * 替身要是跑在同一个进程里，它的 HTTP 服务就没机会应答，
 * 后端发来的请求会一直挂到超时（实测：每次模型调用整整 60s 超时）。
 * 把替身拆成独立进程，它就不受调用方阻塞与否的影响。
 *
 * 替身对**任何路径**都返回同一个 400 —— 用不着知道 SDK 拼出来的 URL 长什么样，
 * 免得 SDK 升级改了路径，替身变成"404 的假端点"，测试跟着静默变形。
 */
export async function startModelStub(): Promise<ModelStubHandle> {
  const proc = Bun.spawn(['bun', 'run', 'spec/verify/model-stub-server.ts'], {
    cwd: new URL('../../', import.meta.url).pathname,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  // 把 stderr 读掉 —— 不然管道写满会卡住子进程
  void new Response(proc.stderr).text().catch(() => undefined);

  const port = await readPort(proc.stdout);

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: async () => {
      try {
        proc.kill();
      } catch {
        /* 可能已经自己退了 */
      }
      await Bun.sleep(100);
    },
  };
}

/** 从子进程 stdout 里读出 `PORT=<n>` */
async function readPort(stream: ReadableStream<Uint8Array>): Promise<number> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  const deadline = Date.now() + 15_000;

  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const match = /PORT=(\d+)/.exec(buffered);
      if (match) return Number(match[1]);
    }
  } finally {
    reader.releaseLock();
  }

  throw new Error(`模型替身没在 15s 内报出端口（收到的输出：${buffered.slice(0, 200) || '空'}）`);
}
