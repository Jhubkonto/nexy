# DeepSeek integration

- [x] Register the desktop provider, credentials and model discovery.
- [x] Support thinking and reasoning across tool rounds.
- [x] Report cached input tokens.
- [x] Support Flash image input and OCR fallback for text-only models.
- [x] Verify provider behavior and type checking with focused tests.
- [x] Verify image rejection retry through dispatch.
- [x] Replace the fixed loop ceiling with model-aware input budgeting and complete-exchange trimming.
- [x] Make finalisation explicit and disable thinking for terminal DeepSeek requests with tools disabled.
- [x] Persist and replay per-turn reasoning and structured tool history; preserve Unicode across network byte boundaries.
- [x] Verify 240 focused tests, including chat history reload and database migration; type checking and targeted lint pass.
- [x] Add Automatic/Manual global output budgets with thinking-aware DeepSeek defaults and provider-qualified ceilings.
- [x] Share one token-limit recovery across streamed rounds and finalisation; preserve completed tools and partial answers, reject truncated batches, and recheck cancellation before retrying.
- [ ] Resolve full main-process suite failures: 27 failures in seven unrelated test files (database migrations, conversation export, IPC mocks, bridge timeouts, worker packaging and Android motion policy).
- [ ] Verify live chat, images, usage and paired Android with a DeepSeek key.

## Android standalone

- [ ] Verify DeepSeek credentials, model discovery, chat and thinking controls on Android.
- [ ] Verify Flash image input with a DeepSeek key; text-only models currently require switching to Flash for images.
- [ ] Verify the Android unit tests and build (Gradle cache/network access required).
- [ ] Add accurate DeepSeek cost reporting when standalone usage includes cache hits and peak/off-peak billing.
