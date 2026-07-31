import jwt, { type SignOptions } from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET ?? "changeme-generate-a-real-secret";
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ?? "12h") as SignOptions["expiresIn"];

export interface JwtPayload {
  sub: number;
  username: string;
  role: "ADMIN" | "CASHIER";
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as unknown as JwtPayload;
}
