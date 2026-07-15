---
schema_version: 1
name: secret-fixture
display_name: 凭证样例
description: 仅使用明显无效的占位字符串验证内容扫描，不包含任何真实凭证
version: 1.0.0
author:
  handle: proma-labs
  name: Proma Labs
category: devops
license: MIT
permissions:
  network: false
  filesystem:
    read: false
    write: none
  shell: false
---

TEST_ONLY_FAKE_TOKEN=not-a-real-secret
