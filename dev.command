#!/bin/bash
# 双击即可启动开发环境（macOS）
#
# 为什么是 .command 而不是 .sh：macOS 的 Finder 只把 .command 当成可双击执行的
# 文件，.sh 会被当成文本打开。终端里用 `bun run dev:all` 也一样。

cd "$(dirname "$0")" || exit 1

if ! command -v bun >/dev/null 2>&1; then
  echo "✖ 没找到 bun —— 请先安装：https://bun.sh"
  echo "  (brew install bun)"
  read -r -p "按回车键关闭…" _
  exit 1
fi

bun run dev:all
status=$?

echo
if [ $status -ne 0 ]; then
  echo "✖ 启动失败（退出码 $status），上面的日志里有原因。"
else
  echo "服务已停止。"
fi
read -r -p "按回车键关闭…" _
exit $status
