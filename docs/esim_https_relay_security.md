# eSIM HTTPS relay 安全配置

`POST /api/esim/https` 的路径和请求/响应格式不变，但 relay 现在默认拒绝所有 SMDP+ 目标，并启用标准 TLS 证书与主机名校验。部署者必须在应用根目录的 `app.config.json` 中显式配置目标策略：

```json
{
  "esimHttpsRelay": {
    "allowedHosts": [
      "smdp.example.com",
      "smdp-backup.example.com:8443"
    ],
    "caCertFiles": [
      "certs/company-ca.pem"
    ],
    "maxRequestBodyBytes": 65536
  }
}
```

- `allowedHosts` 是精确的 HTTPS authority 白名单，仅接受 `host`、`host:port` 或等价的 `https://host[:port]`；不支持通配符、凭据、路径、查询或 fragment。空数组是默认值，所有目标返回 HTTP 403。HTTPS redirect 的每一跳都会重新应用该策略。
- `caCertFiles` 是 PEM CA 文件列表。空数组使用操作系统信任库；配置后会在操作系统信任库基础上追加这些 CA。路径必须相对应用根目录，绝对路径、目录逃逸和解析到根目录外的符号链接会使应用启动失败。
- `maxRequestBodyBytes` 限制 relay JSON 请求体总大小，默认 65536 字节。超过上限返回 HTTP 413；负数或其它无效安全配置会使应用启动失败。

TLS 最低版本为 1.2。证书不受信、主机名不匹配、被禁止的 redirect 或其它上游 TLS/HTTP 错误返回 HTTP 502，并保留可诊断错误信息。不要把密钥或客户端私钥放入此配置；本配置只接受公开 CA 证书。
