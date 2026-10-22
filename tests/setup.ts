// Runs before every test file. Tests never read .env.local and never touch a real database or the real AI.
process.env.AUTH_SECRET = "test-only-auth-secret-0123456789abcdef0123456789";
process.env.AI_CLIENT = "mock";
delete process.env.GEMINI_API_KEY;
