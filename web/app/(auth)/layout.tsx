export default function LayoutAuth({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-12 sm:px-0">
      {children}
    </main>
  );
}
