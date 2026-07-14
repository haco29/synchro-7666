import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// /s/<token> is the unauthenticated public share link (team resolved by token).
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/s/(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
