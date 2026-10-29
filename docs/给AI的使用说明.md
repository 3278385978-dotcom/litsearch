# 给 AI / 接手者的使用说明

> 这份是"最短路径 + 硬性规则"，让人或 AI 拿到工具后不再靠猜。
> 更细的坑见 `docs/常见错误与404排查.md`；方法与纪律见 `docs/加渠道方法论.md`、`docs/检索纪律.md`。

## 1. 三分钟上手

```bash
cd <工具目录>
node find.js --check                                  # 环境自检（认证/网络/浏览器）
node find.js "关键词" --rows=5                        # 默认：论文 + 代码
node find.js "关键词" --src=spis --rows=5             # 指定渠道（SPIS 默认给详情页）
node find.js "关键词" --src=public --rows=5           # 公开库（免认证）
node find.js "关键词" --src=papers --rows=5 --json > out.json   # 机器读
```

## 2. 默认行为（先知道，少走弯路）

| 项 | 默认 | 说明 |
|---|---|---|
| 渠道 | `papers` + `code` | 不包含公开库、不查书 |
| SPIS 链接 | **详情页**（`--link=detail`） | 要出版社原文才加 `--link=article` |
| 输出 | 终端文本 | `--json` 时 stdout **只有 JSON**，日志在 stderr |
| 浏览器 | 无头 | `--show-chrome` 可视化；`--headless` 强制无头 |
| 未配置渠道 | 自动跳过（⚪） | 不是故障 |

## 3. 输出结构（`--json`）

```json
{ "meta": { "time": "...", "onCampus": true, "institution": "..." },
  "results": [
    { "source": "spis", "label": "纬度学术 SPIS", "numFound": 4750,
      "items": [
        { "title": "...", "author": "...", "source": "...", "date": "...",
          "url": "...", "articleUrl": "...", "detailUrl": "...",
          "detailVerified": true, "pdfUrl": "..." }
      ] } ] }
```

- 取链接**只从本轮 JSON 里逐字复制**；不要手打、不要省略；
- `detailVerified: true` 才算详情页有效（SPIS）；
- `pdfUrl` 只表示"有 OA 直链"，不代表一定能下（403/429 见排查表）。

## 4. 硬性规则

1. 用户点哪个渠道就跑哪个，不擅自扩大范围（`--src=` 精确指定）；
2. 只给题录，不打开正文/不下载 PDF（除非用户明确说"读/下"）；
3. 链接逐字完整、必须验证；403/429 ≠ 404；
4. SPIS 默认给详情页；详情页验不过 → 条目不丢，退回原文标 ⚠️；
5. 不给假链接，不把"没查到"说成"没有"；
6. 工具报错先分责：认证 / 反爬 / 无结果 / 真 bug，再决定动作。

## 5. 失败时的报告模板

```
渠道：spis
结果：命中 4750 条，返回 5 条
验证：详情页 5/5 通过（接口复核）
失败：无
（若有失败：第 3 条详情页注册失败 → 已退回出版社原文并标 ⚠️；原因：记录未注册）
```

## 6. 要求"给我详情页"时

直接跑默认命令即可（SPIS 默认就是详情页）。**不要**用出版社原文代替——校园网环境下原文通常下不了，详情页才是可用的入口。

## 7. 环境自检不过时

`node find.js --check` 会报告：出口 IP 是否在校园网段、各渠道认证与命中情况。
- 不在校园网 → 连学校 Wi-Fi / VPN；
- 找不到浏览器 → 装 Chrome/Edge/Chromium/Brave 或设 `LITSEARCH_CHROME`。
