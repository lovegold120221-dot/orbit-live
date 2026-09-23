// Orbit branding and OrbitAI live translation.
config.audioTranslation = {
    ...(config.audioTranslation || {}),
    enabled: true
};
config.defaultLogoUrl = '/orbit-logo.svg';
config.deeplinking = {
    ...(config.deeplinking || {}),
    disabled: true,
    hideLogo: false
};
