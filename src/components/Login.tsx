// หน้าเข้าสู่ระบบของ PackIt — โมเดิร์นมินิมอลตามธีมเดิม
// ปุ่ม Google เป็นแบบจำลอง (ยังไม่ต่อ OAuth จริง) กดแล้วเข้าแอปเลย

// โลโก้กล่องทรงไอโซเมตริก สื่อถึงงานบรรจุภัณฑ์
function PackItMark() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2 21 7v10l-9 5-9-5V7z" />
      <path d="M3.3 7 12 12l8.7-5" />
      <path d="M12 12v10" />
    </svg>
  )
}

// โลโก้ Google 4 สี (มาตรฐานปุ่ม Sign in with Google)
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.9 2.4 30.5 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.9 6.1C12.2 13.2 17.6 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.9z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.5 10.7l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.3-4.5 2.1-8.8 2.1-6.4 0-11.8-3.7-13.6-9.9l-7.9 6.1C6.4 42.6 14.6 48 24 48z"
      />
    </svg>
  )
}

export function Login({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-mark">
            <PackItMark />
          </span>
          <span className="login-name">PackIt</span>
        </div>
        <h1 className="login-title">ยินดีต้อนรับ</h1>
        <p className="login-sub">
          ออกแบบบรรจุภัณฑ์ 3D พร้อม blueprint การพับ
          <br />
          เข้าสู่ระบบเพื่อเริ่มงานของคุณ
        </p>
        <button className="google-btn" onClick={onLogin}>
          <GoogleG />
          <span>เข้าสู่ระบบด้วย Google</span>
        </button>
        <p className="login-fine">เดโม่ · ยังไม่ได้เชื่อมต่อบัญชี Google จริง</p>
      </div>
      <p className="login-footer">PackIt · เครื่องมือสร้างแพ็กเกจแบบพารามิเตอร์</p>
    </div>
  )
}
