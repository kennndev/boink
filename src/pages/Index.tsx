/* ORIGINAL PAGE TEMPORARILY DISABLED
import { useState, useEffect } from "react";
import { DesktopIcon } from "@/components/DesktopIcon";
import { Taskbar } from "@/components/Taskbar";
import { Window } from "@/components/Window";
// ... all original imports and component code commented out
*/

const Index = () => {
  return (
    <div style={{
      margin: 0,
      padding: 0,
      width: "100vw",
      height: "100vh",
      backgroundColor: "#000",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    }}>
      {/* Modal */}
      <div style={{
        backgroundColor: "#111",
        border: "1px solid #333",
        borderRadius: "8px",
        padding: "40px",
        maxWidth: "480px",
        width: "90%",
        boxShadow: "0 0 0 1px rgba(255,255,255,0.05), 0 20px 60px rgba(0,0,0,0.8)",
      }}>
        {/* Vercel Logo */}
        <div style={{ marginBottom: "28px" }}>
          <svg
            width="76"
            height="65"
            viewBox="0 0 76 65"
            fill="white"
            xmlns="http://www.w3.org/2000/svg"
            style={{ width: "24px", height: "auto" }}
          >
            <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
          </svg>
        </div>

        {/* Status badge */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          backgroundColor: "#1a1a1a",
          border: "1px solid #333",
          borderRadius: "20px",
          padding: "4px 12px",
          marginBottom: "24px",
        }}>
          <span style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            backgroundColor: "#f5a623",
            display: "inline-block",
          }} />
          <span style={{ color: "#888", fontSize: "12px", fontWeight: 500 }}>
            Deployment Suspended
          </span>
        </div>

        {/* Heading */}
        <h1 style={{
          color: "#fff",
          fontSize: "20px",
          fontWeight: 600,
          margin: "0 0 12px 0",
          letterSpacing: "-0.3px",
          lineHeight: 1.3,
        }}>
          This page has been temporarily taken down
        </h1>

        {/* Body text */}
        <p style={{
          color: "#888",
          fontSize: "14px",
          lineHeight: 1.7,
          margin: "0 0 28px 0",
        }}>
          This deployment has been disabled by Vercel and is no longer accessible.
          If you believe this is a mistake or need to restore access, please reach out
          to the Vercel support team.
        </p>

        {/* Divider */}
        <div style={{
          borderTop: "1px solid #222",
          marginBottom: "24px",
        }} />

        {/* Contact button */}
        <a
          href="https://vercel.com/help"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            backgroundColor: "#fff",
            color: "#000",
            fontSize: "13px",
            fontWeight: 600,
            padding: "8px 16px",
            borderRadius: "6px",
            textDecoration: "none",
            transition: "opacity 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
        >
          Contact Vercel
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </a>

        {/* Footer note */}
        <p style={{
          color: "#555",
          fontSize: "12px",
          margin: "20px 0 0 0",
        }}>
          Error code: <span style={{ fontFamily: "monospace", color: "#666" }}>DEPLOYMENT_BLOCKED</span>
        </p>
      </div>
    </div>
  );
};

export default Index;
