import "bun:test";

declare module "bun:test" {
  interface Matchers<T = unknown> {
    toBeDisabled(): any;
    toBeVisible(): any;
    toHaveAttribute(attribute: string, value?: string | RegExp): any;
  }
}
