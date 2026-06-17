import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongoose";
import User from "@/models/User";
import { createToken } from "@/lib/auth";

// Temp OTP store (resets on server restart, fine for single user)
let pendingOTP = null;
let otpExpiry = null;

export async function POST(request) {
  const { step, email, password, otp } = await request.json();

  // Step 1 — verify email + password
  if (step === "credentials") {
    if (
      email !== process.env.AUTH_EMAIL ||
      password !== process.env.AUTH_PASSWORD
    ) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    // Generate OTP
    pendingOTP = process.env.AUTH_OTP;
    otpExpiry = Date.now() + 5 * 60 * 1000; // 5 mins

    return NextResponse.json({ success: true, message: "OTP sent" });
  }

  // Step 2 — verify OTP
  if (step === "otp") {
    if (!pendingOTP || Date.now() > otpExpiry) {
      return NextResponse.json({ error: "OTP expired" }, { status: 401 });
    }
    if (otp !== pendingOTP) {
      return NextResponse.json({ error: "Invalid OTP" }, { status: 401 });
    }

    // Clear OTP
    pendingOTP = null;
    otpExpiry = null;

    // Create user if not exists
    await connectDB();
    await User.findOneAndUpdate(
      { email: process.env.AUTH_EMAIL },
      { $setOnInsert: { email: process.env.AUTH_EMAIL } },
      { upsert: true, new: true },
    );

    // Set JWT cookie
    const token = createToken(process.env.AUTH_EMAIL);
    const response = NextResponse.json({ success: true });
    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return response;
  }

  return NextResponse.json({ error: "Invalid step" }, { status: 400 });
}
