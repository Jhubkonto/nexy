# DeepSeek integration

- [x] Register the desktop provider, credentials and model discovery.
- [x] Support thinking and reasoning across tool rounds.
- [x] Report cached input tokens.
- [x] Support Flash image input and OCR fallback for text-only models.
- [x] Verify provider behavior and type checking with focused tests.
- [x] Verify image rejection retry through dispatch.
- [ ] Resolve full main-process suite failures: 27 failures in seven unrelated test files (database migrations, conversation export, IPC mocks, bridge timeouts, worker packaging and Android motion policy).
- [ ] Verify live chat, images, usage and paired Android with a DeepSeek key.

## Android standalone

- [ ] Verify DeepSeek credentials, model discovery, chat and thinking controls on Android.
- [ ] Verify Flash image input with a DeepSeek key; text-only models currently require switching to Flash for images.
- [ ] Verify the Android unit tests and build (Gradle cache/network access required).
- [ ] Add accurate DeepSeek cost reporting when standalone usage includes cache hits and peak/off-peak billing.
