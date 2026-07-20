const SPLASH_PREFERENCE_KEY = 'webaudioapi-labs:hide-how-it-works';

const labIndex = document.querySelector('.lab-index');
const splashTitle = document.getElementById('splash-title');
const labsTitle = document.getElementById('labs-title');
const dismissSplashButton = document.getElementById('dismiss-splash');
const showSplashButton = document.getElementById('show-splash');
const splashPreference = document.getElementById('splash-preference');
const hideSplashPreference = document.getElementById('hide-splash-preference');
const isGuideRequested = new URLSearchParams(window.location.search).get('guide') === '1';
const guideReferrer = (() => {
  if (!isGuideRequested || document.referrer === '') return null;

  try {
    const referrerUrl = new URL(document.referrer);
    return referrerUrl.origin === window.location.origin ? referrerUrl : null;
  } catch {
    return null;
  }
})();

if (
  !(labIndex instanceof HTMLElement) ||
  splashTitle === null ||
  labsTitle === null ||
  !(dismissSplashButton instanceof HTMLButtonElement) ||
  !(showSplashButton instanceof HTMLButtonElement) ||
  !(splashPreference instanceof HTMLLabelElement) ||
  !(hideSplashPreference instanceof HTMLInputElement)
) {
  throw new Error('Splash screen markup is missing required elements.');
}

const getSavedPreference = (): boolean => {
  try {
    return window.localStorage.getItem(SPLASH_PREFERENCE_KEY) === 'true';
  } catch {
    return false;
  }
};

const savePreference = (hideSplash: boolean): void => {
  try {
    if (hideSplash) {
      window.localStorage.setItem(SPLASH_PREFERENCE_KEY, 'true');
    } else {
      window.localStorage.removeItem(SPLASH_PREFERENCE_KEY);
    }
  } catch {
    // The preference remains active for this visit if browser storage is unavailable.
  }
};

const setSplashDismissed = (dismissed: boolean): void => {
  labIndex.classList.toggle('is-splash-dismissed', dismissed);
  showSplashButton.hidden = !dismissed;
};

splashPreference.hidden = isGuideRequested;
if (isGuideRequested) {
  showSplashButton.textContent = 'Back';
}
setSplashDismissed(isGuideRequested ? false : getSavedPreference());

dismissSplashButton.addEventListener('click', () => {
  if (!splashPreference.hidden) {
    savePreference(hideSplashPreference.checked);
  }
  setSplashDismissed(true);
  labsTitle.focus();
});

showSplashButton.addEventListener('click', () => {
  if (isGuideRequested) {
    if (guideReferrer !== null) {
      window.history.back();
    } else {
      window.location.assign('/');
    }
    return;
  }

  savePreference(false);
  hideSplashPreference.checked = false;
  splashPreference.hidden = true;
  setSplashDismissed(false);
  splashTitle.focus();
});
