# 发布规范（自动发布 · Tag 触发）

本项目**不手动 `npm publish`**。发布唯一入口是**推送 `v*` tag**，由 GitHub Actions 自动完成。

## 链路

```
git push --follow-tags
        │
        ▼
GitHub Actions: .github/workflows/release.yml   (触发: push tags: v*)
  1. 校验 tag 与 package.json 版本一致（不一致 → 失败）
  2. 语法检查 + 冒烟测试 + i18n 键一致性
  3. npm Trusted Publishing（OIDC）发布，附 provenance
  4. GitHub Release 正文 = CHANGELOG 当前版本条目
```

CI（`.github/workflows/ci.yml`）只在 push `main` / PR 时跑检查，不发布。

## CHANGELOG 约定

- 每个版本必须有 `## <semver> — <YYYY-MM-DD>` 条目，缺失时 release workflow 直接失败。
- Release 正文从 CHANGELOG 自动抽取，不手写。
- 分类：`新增` / `变更` / `修复` / `移除` / `安全`。

## 首次发布前（人工，一次性）

npm 包需要配置 Trusted Publisher（OIDC），否则 release workflow 的 publish 步骤会失败：

1. 先手动发布一次或让包在 npm 上存在（首次可临时用 token `npm publish --access public`）；
2. npmjs.com → 包设置 → Trusted Publisher → GitHub Actions：
   - Organization or user: `PonyDevAI`
   - Repository: `dsh-phone`
   - Workflow filename: `release.yml`
3. 之后删掉临时 token，全部走 OIDC。

## 标准发版步骤

```bash
# 1. 更新 CHANGELOG.md（新增版本条目）
# 2. 更新 package.json version
npm run check && npm run smoke
git add -A && git commit -m "chore(release): v0.1.0"
git tag v0.1.0
git push --follow-tags
```
