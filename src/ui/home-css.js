export const HOME_CSS = `
.hero{padding:26px 0 14px}
.hero-badge{display:inline-block;font-size:12px;font-weight:600;color:var(--brand);
  background:rgba(34,211,165,.09);border:1px solid rgba(34,211,165,.26);
  padding:4px 11px;border-radius:999px;margin-bottom:16px;letter-spacing:.02em}
.hero h1{font-size:38px;line-height:1.22}
.hero h1 .h1-sub{color:var(--muted);font-size:30px}
.analyze{margin:26px 0 8px}
.input-row{display:flex;gap:10px;flex-wrap:wrap}
.input-row input{flex:1 1 320px;padding:14px 16px;font-size:15px}
.input-row button{flex:0 0 auto;padding:14px 26px}
.hint{font-size:13px;color:var(--muted);margin-top:9px}
.stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));
  gap:12px;margin:30px 0 6px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius-sm);
  padding:14px 16px;display:flex;flex-direction:column;gap:2px}
.stat b{font-size:24px;letter-spacing:-.02em;background:linear-gradient(135deg,var(--brand),var(--brand-2));
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.stat span{font-size:12.5px;color:var(--muted)}
.features{grid-template-columns:repeat(3,1fr)}
.feature{position:relative;overflow:hidden}
@media(max-width:860px){.features{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.features{grid-template-columns:1fr}}
.feature .fi{font-family:var(--mono);font-size:11px;color:var(--brand);opacity:.7;margin-bottom:8px;letter-spacing:.08em}
.feature h3{font-size:15px}
.feature p{font-size:13.5px;margin:6px 0 0;line-height:1.6}
.dim-list{display:flex;flex-direction:column;gap:2px;background:var(--panel);
  border:1px solid var(--line);border-radius:var(--radius);padding:8px 18px}
.dim-row{display:grid;grid-template-columns:96px 90px 44px 1fr;gap:14px;align-items:center;
  padding:11px 0;border-bottom:1px solid var(--line-soft);font-size:13.5px}
.dim-row:last-child{border-bottom:none}
.dim-name{font-weight:600}
.dim-bar{height:5px;background:var(--line);border-radius:3px;overflow:hidden}
.dim-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--brand),var(--brand-2));border-radius:3px}
.dim-w{font-family:var(--mono);font-size:12px;color:var(--brand);text-align:right}
.dim-desc{color:var(--muted);font-size:12.5px}
.toc{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px}
.toc a{font-family:var(--mono);font-size:12px;padding:5px 10px;border-radius:7px;
  background:var(--panel);border:1px solid var(--line);color:var(--muted)}
.toc a:hover{color:var(--brand);border-color:rgba(34,211,165,.4);text-decoration:none}
.ep{margin:0 0 24px;padding:18px 20px;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius)}
.ep-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.ep-path{font-size:13px;color:var(--brand);background:transparent;border:none;padding:0}
.ep-label{font-size:11.5px;color:var(--dim);text-transform:uppercase;letter-spacing:.08em;margin-top:12px}
@media(max-width:640px){
  .hero h1{font-size:27px}
  .hero h1 .h1-sub{font-size:22px}
  .dim-row{grid-template-columns:1fr auto;gap:6px}
  .dim-bar,.dim-desc{grid-column:1/-1}
  .dim-w{text-align:right}
}
`;
