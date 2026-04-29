"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      toast.success("Đã sao chép");
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="relative group">
      <pre className={`bg-slate-900 text-slate-100 rounded-lg p-4 text-xs overflow-x-auto leading-relaxed language-${language}`}>
        <code>{code}</code>
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 w-7 h-7 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={copy}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border border-slate-100 shadow-sm bg-white">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-800">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function DocsClient() {
  return (
    <div className="max-w-3xl space-y-6">
      {/* Overview */}
      <Section title="1. Tổng quan">
        <div className="text-sm text-slate-600 space-y-2">
          <p>VSO Gateway cung cấp 2 phương thức gửi tin nhắn:</p>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li><strong>HTTP API</strong> — RESTful JSON, xác thực bằng API Key + HMAC-SHA256</li>
            <li><strong>SMPP</strong> — kết nối TCP trực tiếp tới port <code className="bg-slate-100 px-1 rounded">2775</code>, xác thực bằng system_id + password</li>
          </ul>
          <p className="mt-2">
            Base URL: <code className="bg-slate-100 px-2 py-0.5 rounded text-sky-700 font-mono">https://gw.tkc.vn</code>
          </p>
        </div>
      </Section>

      {/* HTTP API */}
      <Section title="2. Gửi tin nhắn qua HTTP API">
        <p className="text-sm text-slate-600">
          Tất cả request cần 3 header xác thực: <code className="bg-slate-100 px-1 rounded">X-Api-Key</code>, <code className="bg-slate-100 px-1 rounded">X-Timestamp</code>, và <code className="bg-slate-100 px-1 rounded">X-Signature</code>.
        </p>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Tạo chữ ký HMAC-SHA256 (bash)</p>
          <CodeBlock code={`KEY_ID="ak_live_YOUR_KEY_ID"
SECRET="YOUR_RAW_SECRET"
TS=$(date +%s)
BODY='{"source_addr":"VSOSMS","dest_addr":"84901234567","content":"Xin chao tu VSO Gateway!"}'
# canonical string: METHOD\\nPATH\\nTIMESTAMP\\nBODY
CANONICAL="POST\\n/api/v1/messages\\n\${TS}\\n\${BODY}"
SIG=$(printf "%b" "\$CANONICAL" | openssl dgst -sha256 -hmac "\$SECRET" -hex | awk '{print \$2}')

curl -X POST https://gw.tkc.vn/api/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "X-Api-Key: \$KEY_ID" \\
  -H "X-Timestamp: \$TS" \\
  -H "X-Signature: \$SIG" \\
  -d "\$BODY"`} />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Response thành công (202)</p>
          <CodeBlock language="json" code={`{
  "message_id": "01HZ8K3M9X8Q5ABCDEF...",
  "status": "ACCEPTED",
  "created_at": "2026-04-28T08:30:00Z"
}`} />
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Request body đầy đủ</p>
          <CodeBlock language="json" code={`{
  "source_addr": "VSOSMS",        // Sender ID (≤11 ký tự alpha hoặc ≤15 số)
  "dest_addr": "84901234567",     // E.164 không có '+' prefix
  "content": "Nội dung tin nhắn", // ≤160 ký tự GSM7
  "encoding": "GSM7",             // GSM7 | UCS2 | LATIN1
  "type": "SMS",                  // SMS | VOICE_OTP
  "client_ref": "your-ref-123"    // Tùy chọn — ref nội bộ của bạn
}`} />
        </div>
      </Section>

      {/* Query status */}
      <Section title="3. Tra cứu trạng thái tin nhắn">
        <CodeBlock code={`curl -X GET "https://gw.tkc.vn/api/v1/messages/01HZ8K3M9X8Q5ABCDEF..." \\
  -H "X-Api-Key: \$KEY_ID" \\
  -H "X-Timestamp: \$TS" \\
  -H "X-Signature: \$SIG"`} />
        <div className="text-sm text-slate-600 space-y-1">
          <p>Các trạng thái tin nhắn:</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["RECEIVED", "Đã nhận — đang xử lý"],
              ["ROUTED", "Đã chọn kênh gửi"],
              ["SUBMITTED", "Đã gửi tới nhà mạng"],
              ["DELIVERED", "Nhà mạng xác nhận thành công"],
              ["FAILED", "Gửi thất bại — xem error_code"],
            ].map(([state, desc]) => (
              <div key={state} className="flex gap-2 items-start">
                <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono flex-shrink-0">{state}</code>
                <span className="text-xs text-slate-500">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* SMPP */}
      <Section title="4. Kết nối SMPP">
        <div className="text-sm text-slate-600 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Host", "gw.tkc.vn"],
              ["Port", "2775"],
              ["System Type", ""],
              ["Bind Type", "TRANSCEIVER (khuyến nghị)"],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="text-slate-400 w-28 flex-shrink-0 text-xs pt-0.5">{k}</span>
                <code className="text-xs font-mono text-slate-700">{v || <span className="text-slate-300 italic">Xem trang SMPP Accounts</span>}</code>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            System ID và Password lấy từ trang <strong>SMPP Accounts</strong>. Để thay đổi password, dùng nút Đổi mật khẩu.
          </p>
        </div>
      </Section>

      {/* DLR */}
      <Section title="5. Nhận DLR qua Webhook">
        <p className="text-sm text-slate-600">
          Cấu hình Webhook URL tại trang <strong>Webhook DLR</strong>. Payload nhận được:
        </p>
        <CodeBlock language="json" code={`{
  "message_id": "01HZ8K3M9X8Q5ABCDEF...",
  "state": "DELIVERED",
  "dest_addr": "84901234567",
  "submitted_at": "2026-04-28T08:30:01Z",
  "delivered_at": "2026-04-28T08:30:08Z",
  "error_code": null,
  "client_ref": "your-ref-123"
}`} />
        <p className="text-xs text-slate-400">
          Gateway sẽ retry tối đa 3 lần nếu server trả code khác 2xx (interval: 30s, 5m, 30m).
        </p>
      </Section>
    </div>
  );
}
