"use client";

/** 页面渲染出错时显示的兜底页，免得整页空白。数据没有丢：仍在浏览器里，登录的话云端也有一份 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ display: "flex", height: "100dvh" }}>
      <div className="cases">
        <div className="empty">
          <h3>页面出了点问题</h3>
          <p>你的内容没有丢，仍然保存着。可以先点「重试」；还不行的话刷新页面。如果反复出现，请通过「联系我们」告诉我们你刚才在做什么。</p>
          <div className="form-actions" style={{ justifyContent: "center" }}>
            <button className="btn-ghost" onClick={() => window.location.reload()}>
              刷新页面
            </button>
            <button className="btn-accent" onClick={reset}>
              重试
            </button>
          </div>
          {error?.message && <p style={{ fontSize: 12, opacity: 0.6, marginTop: 12 }}>错误信息：{error.message.slice(0, 200)}</p>}
        </div>
      </div>
    </main>
  );
}
