import { NextResponse, type NextRequest } from "next/server";
import { isAllowedHost } from "@/lib/security";

/** Runs before every request: only answer to loopback host names (see isAllowedHost for why). */
export function proxy(request: NextRequest) {
  if (!isAllowedHost(request.headers.get("host"))) {
    return new NextResponse("Forbidden: this app only answers to localhost. Set ALLOWED_HOSTS to allow other names.", { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)" };
