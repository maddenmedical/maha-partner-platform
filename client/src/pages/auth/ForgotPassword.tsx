import { Link } from "wouter";
import { MahaWordmark } from "@/components/MahaLogo";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, ArrowLeft } from "lucide-react";

const SUPPORT_EMAIL = "partner@maha.clinic";

export default function ForgotPassword() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md shadow-lg" data-testid="card-forgot-password">
        <CardHeader className="flex flex-col items-center gap-3 pb-2 pt-8">
          <MahaWordmark width={220} />
          <p className="text-base text-muted-foreground text-center">Reset your password</p>
        </CardHeader>
        <CardContent className="p-8 pt-4">
          <div className="flex flex-col items-center gap-4 text-center py-2" data-testid="text-forgot-contact">
            <Mail className="h-10 w-10 text-primary" />
            <p className="text-sm text-foreground">
              We reset passwords manually to keep your account secure. Email us at{" "}
              <span className="font-medium">{SUPPORT_EMAIL}</span> and we'll set a new password for
              you right away.
            </p>
            <Button asChild className="h-12 font-medium w-full" data-testid="button-email-support">
              <a href={`mailto:${SUPPORT_EMAIL}?subject=Password%20reset%20request`}>
                Email {SUPPORT_EMAIL}
              </a>
            </Button>
          </div>
          <Link
            href="/"
            className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mt-6"
            data-testid="link-back-to-login"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
