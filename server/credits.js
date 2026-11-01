export function replenishCredits(user, now, settings) {
  const updatedAt = new Date(user.creditUpdatedAt).getTime();
  const currentCredits = Math.min(settings.maxCredits, user.credits);

  if (currentCredits >= settings.maxCredits) {
    return { credits: settings.maxCredits, creditUpdatedAt: new Date(now) };
  }

  const intervalMs = settings.regenIntervalSeconds * 1000;
  const intervals = Math.floor((now - updatedAt) / intervalMs);
  if (intervals <= 0) {
    return { credits: currentCredits, creditUpdatedAt: new Date(updatedAt) };
  }

  const credits = Math.min(
    settings.maxCredits,
    currentCredits + intervals * settings.creditsPerRegen,
  );
  const creditUpdatedAt =
    credits === settings.maxCredits
      ? new Date(now)
      : new Date(updatedAt + intervals * intervalMs);

  return { credits, creditUpdatedAt };
}
