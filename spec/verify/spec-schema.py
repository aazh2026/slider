#!/usr/bin/env python3
"""
校验 spec/spec.yaml 是否符合 spec/spec.schema.json（JSON Schema draft 2020-12）。

用法：
    python3 spec/verify/spec-schema.py

退出码：
    0  校验通过
    1  校验失败（逐条打印错误）
    2  文件缺失或解析失败
"""
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("缺少依赖：pip install pyyaml")
try:
    from jsonschema import Draft202012Validator
except ImportError:
    sys.exit("缺少依赖：pip install jsonschema")

ROOT = Path(__file__).resolve().parents[2]
SPEC_PATH = ROOT / "spec" / "spec.yaml"
SCHEMA_PATH = ROOT / "spec" / "spec.schema.json"


def main() -> int:
    if not SPEC_PATH.exists():
        print(f"找不到 Spec 文件：{SPEC_PATH}", file=sys.stderr)
        return 2
    if not SCHEMA_PATH.exists():
        print(f"找不到 Schema 文件：{SCHEMA_PATH}", file=sys.stderr)
        return 2

    try:
        spec = yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        print(f"Spec YAML 解析失败：\n{e}", file=sys.stderr)
        return 2

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(spec), key=lambda e: list(e.absolute_path))

    if not errors:
        clauses = spec.get("clauses", [])
        by_maturity: dict[str, int] = {}
        for c in clauses:
            by_maturity[c["maturity"]] = by_maturity.get(c["maturity"], 0) + 1
        criteria = sum(len(c.get("acceptance", [])) for c in clauses)
        print(f"✅ Spec 结构校验通过：{len(clauses)} 条条款，{criteria} 条验收判据")
        print("   成熟度分布：" + "，".join(f"{k}={v}" for k, v in sorted(by_maturity.items())))
        return 0

    print(f"❌ Spec 结构校验失败：{len(errors)} 处错误\n", file=sys.stderr)
    for err in errors:
        path = "/".join(str(p) for p in err.absolute_path) or "(root)"
        print(f"  · {path}", file=sys.stderr)
        print(f"    {err.message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
