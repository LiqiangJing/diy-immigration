/** 隐私政策、服务条款页面共用的版式 */
export default function Legal({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <main style={{ display: "flex", height: "100dvh" }}>
      <div className="cases legal">
        <p className="legal-nav">
          <a href="/">← 返回 DIY Immigration</a>
          <span>
            <a href="/terms">服务条款</a> · <a href="/privacy">隐私政策</a>
          </span>
        </p>
        <h1>{title}</h1>
        <p className="legal-date">最后更新：{updated}</p>
        {children}
      </div>
    </main>
  );
}
