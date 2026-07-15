# Marketplace Skill Fixtures

这些 fixture 由 API 校验与 Electron installer 共用，不包含真实凭证或可执行恶意载荷。

| 目录 | 预期 |
|---|---|
| `valid-minimal` | Manifest V1 合法 |
| `valid-full` | 含多语言、标签与权限的合法包 |
| `invalid-missing-skill-md` | `PACKAGE_SKILL_MD_MISSING` |
| `invalid-frontmatter` | `MANIFEST_YAML_INVALID` |
| `invalid-secret` | 后续内容扫描返回 secret warning/error |
| `updates/clean` | 市场来源未修改，可升级 |
| `updates/locally-modified` | 本地 hash 不一致，必须冲突 |
| `updates/downgrade` | 本地版本更高，必须确认降级 |

ZIP traversal、symlink、重复路径和 zip bomb 特征由测试运行时构造，避免提交可能被误用的二进制载荷。
