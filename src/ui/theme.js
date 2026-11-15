/** 页面共享的 CSS。手写、无框架、约 12KB，首屏无闪烁。 */
export const BASE_CSS = `
:root{
  --bg:#0b0f14; --bg-soft:#0f151c; --panel:#121a23; --panel-2:#16202b;
  --line:#1e2a38; --line-soft:#182430;
  --text:#e6edf3; --muted:#8b9bab; --dim:#5f7183;
  --brand:#22d3a5; --brand-2:#38bdf8; --brand-glow:rgba(34,211,165,.16);
  --pass:#22c55e; --warn:#eab308; --fail:#ef4444; --info:#38bdf8;
  --radius:14px; --radius-sm:9px;
  --mono:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--bg);color:var(--text);font-family:var(--sans);
  font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased;
  background-image:radial-gradient(900px 480px at 12% -8%,rgba(34,211,165,.10),transparent 65%),
                   radial-gradient(760px 420px at 88% -12%,rgba(56,189,248,.09),transparent 62%);
  background-attachment:fixed;
}
a{color:var(--brand);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}
header.site{position:sticky;top:0;z-index:20;backdrop-filter:blur(12px);
  background:rgba(11,15,20,.82);border-bottom:1px solid var(--line-soft)}
header.site .bar{display:flex;align-items:center;gap:14px;height:58px}
.brand{display:flex;align-items:center;gap:9px;font-weight:700;letter-spacing:-.01em;font-size:16px;color:var(--text)}
.brand img{width:26px;height:26px}
.brand span i{font-style:normal;color:var(--brand)}
nav.top{margin-left:auto;display:flex;gap:18px;align-items:center;font-size:13.5px}
nav.top a{color:var(--muted)}
nav.top a:hover{color:var(--text);text-decoration:none}
main{padding:34px 0 72px}
h1{font-size:30px;line-height:1.25;letter-spacing:-.02em;margin:0 0 10px}
h2{font-size:19px;letter-spacing:-.01em;margin:34px 0 14px}
h3{font-size:15.5px;margin:0 0 6px}
p.lede{color:var(--muted);font-size:16px;margin:0 0 26px;max-width:74ch}
.panel{background:linear-gradient(180deg,var(--panel),var(--bg-soft));border:1px solid var(--line);
  border-radius:var(--radius);padding:20px}
.muted{color:var(--muted)}.dim{color:var(--dim)}
.mono{font-family:var(--mono)}
.center{text-align:center}
.row{display:flex;gap:14px;flex-wrap:wrap}
.grow{flex:1 1 220px}
.tag{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;
  font-size:11.5px;font-weight:600;letter-spacing:.01em;border:1px solid transparent}
.tag.pass{color:#86efac;background:rgba(34,197,94,.11);border-color:rgba(34,197,94,.28)}
.tag.warn{color:#fde68a;background:rgba(234,179,8,.11);border-color:rgba(234,179,8,.3)}
.tag.fail{color:#fca5a5;background:rgba(239,68,68,.11);border-color:rgba(239,68,68,.3)}
.tag.info{color:#7dd3fc;background:rgba(56,189,248,.11);border-color:rgba(56,189,248,.28)}
.tag.skip{color:var(--muted);background:rgba(139,155,171,.1);border-color:rgba(139,155,171,.24)}
button,.btn{font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;
  border-radius:10px;padding:11px 20px;border:1px solid transparent;transition:.16s ease}
.btn-primary{background:linear-gradient(135deg,var(--brand),#12b98f);color:#04231b;
  box-shadow:0 6px 20px -8px var(--brand-glow)}
.btn-primary:hover{filter:brightness(1.08);text-decoration:none}
.btn-ghost{background:transparent;border-color:var(--line);color:var(--text)}
.btn-ghost:hover{background:var(--panel-2);text-decoration:none}
input[type=url],input[type=text],textarea{width:100%;font-family:inherit;font-size:15px;
  background:var(--bg-soft);border:1px solid var(--line);color:var(--text);
  border-radius:10px;padding:12px 14px;transition:.16s}
input:focus,textarea:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-glow)}
code,pre{font-family:var(--mono);font-size:12.5px}
pre{background:#080c11;border:1px solid var(--line);border-radius:var(--radius-sm);
  padding:14px 16px;overflow:auto;line-height:1.6;margin:10px 0}
pre code{font-size:12.5px;color:#cbd5e1}
:not(pre)>code{background:var(--panel-2);padding:2px 6px;border-radius:5px;
  border:1px solid var(--line);color:#a5f3d0}
.skip-link{position:absolute;left:-9999px;top:0;z-index:60;background:var(--brand);color:#04231b;
  padding:10px 16px;border-radius:0 0 10px 0;font-weight:700;font-size:13.5px}
.skip-link:focus{left:0;text-decoration:none}
footer.site{border-top:1px solid var(--line-soft);padding:26px 0;color:var(--dim);font-size:13px}
footer.site .wrap{display:flex;gap:10px 16px;flex-wrap:wrap;align-items:center}
footer.site .foot-links{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.grid{display:grid;gap:14px}
.g2{grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.g3{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.g4{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px}
.kv{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--line-soft);font-size:13.5px}
.kv:last-child{border-bottom:none}
.kv .k{color:var(--muted)}
.kv .v{font-family:var(--mono);font-size:12.5px;text-align:right;word-break:break-all;max-width:62%}
@media(max-width:640px){
  h1{font-size:24px}main{padding:24px 0 56px}
  .wrap{padding:0 16px}
  nav.top{gap:12px;font-size:13px}
}
`;
