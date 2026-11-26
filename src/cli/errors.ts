/** An error whose message is written for the person or agent running the CLI. Printed without a trace. */
export class UserError extends Error {
  override name = 'UserError';
  /** When the error is a list of problems (an invalid script), each one: `--json` prints them. */
  readonly errors: string[] | undefined;

  constructor(message: string, errors?: string[]) {
    super(message);
    this.errors = errors;
  }

  /** One error per problem, the message listing them one per line. */
  static list(errors: string[]): UserError {
    return new UserError(errors.join('\n'), errors);
  }
}
