import { z } from 'zod';

// The daemon's Content-Security-Policy forbids eval. Zod checks whether it may use it the first
// time an object schema is built, so this module is imported before any other.
z.config({ jitless: true });
