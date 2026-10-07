"use client";

/** Last resort if the app shell itself fails. Plain styling: nothing here can depend on the app. */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
        <div>
          <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
          <p style={{ color: "#666", maxWidth: 420 }}>The app couldn&apos;t start. Your data is safe. Check the terminal where the server is running, then try again.</p>
          <button onClick={reset} style={{ padding: "8px 16px" }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
