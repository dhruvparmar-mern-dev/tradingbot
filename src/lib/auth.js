import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { connectDB } from "./mongoose";
import User from "@/models/User";

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded;
  } catch {
    return null;
  }
}

export async function getUser() {
  const session = await getSession();
  if (!session) return null;

  await connectDB();
  const user = await User.findOne({ email: session.email });
  return user;
}

export function createToken(email) {
  return jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: "30d" });
}
