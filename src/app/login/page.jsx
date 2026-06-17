"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCredentials = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "credentials", email, password }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error);
      toast.success("OTP sent to your email!");
      setStep("otp");
    } catch {
      toast.error("Something went wrong");
    }
    setLoading(false);
  };

  const handleOTP = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "otp", otp }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error);
      toast.success("Welcome back!");
      //   window.location.href = "/";
      router.push("/");
      router.refresh();
    } catch {
      toast.error("Something went wrong");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="text-3xl mb-2">📈</div>
          <h1 className="text-xl font-bold text-white">TradingBot</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Your AI-powered trading assistant
          </p>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex flex-col gap-4">
          {step === "credentials" ? (
            <>
              <div>
                <h2 className="text-white font-semibold mb-1">Sign In</h2>
                <p className="text-zinc-500 text-xs">
                  Enter your credentials to continue
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCredentials()}
                    placeholder="your@email.com"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCredentials()}
                    placeholder="••••••••"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              <button
                onClick={handleCredentials}
                disabled={loading || !email || !password}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
              >
                {loading ? "Verifying..." : "Continue"}
              </button>
            </>
          ) : (
            <>
              <div>
                <h2 className="text-white font-semibold mb-1">Enter OTP</h2>
                <p className="text-zinc-500 text-xs">
                  OTP has been sent to your email
                </p>
              </div>

              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleOTP()}
                placeholder="Enter OTP"
                maxLength={6}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-zinc-500 text-center tracking-widest text-lg"
              />

              <button
                onClick={handleOTP}
                disabled={loading || otp.length < 4}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
              >
                {loading ? "Verifying..." : "Verify OTP"}
              </button>

              <button
                onClick={() => setStep("credentials")}
                className="text-xs text-zinc-500 hover:text-zinc-300 text-center transition-colors"
              >
                ← Back
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
