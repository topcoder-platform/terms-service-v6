/** Validate injected values inside ECS; deployment jobs cannot read secrets. */
export function validateRuntimeConfig(env: NodeJS.ProcessEnv = process.env): void {
  if ((env.ECS_CONTAINER_METADATA_URI_V4 || env.ECS_CONTAINER_METADATA_URI ||
       env.AWS_EXECUTION_ENV?.startsWith('AWS_ECS')) && !env.JWT_AUDIENCE?.trim()) {
    throw new Error('JWT_AUDIENCE must be nonempty for the trusted browser application');
  }
}
