const SPLASH_PREFERENCE_KEY = 'webaudioapi-labs:hide-how-it-works';

const labIndex = document.querySelector('.lab-index');
const splashTitle = document.getElementById('splash-title');
const labsTitle = document.getElementById('labs-title');
const dismissSplashButton = document.getElementById('dismiss-splash');
const showSplashButton = document.getElementById('show-splash');
const hideSplashPreference = document.getElementById('hide-splash-preference');

if (
  !(labIndex instanceof HTMLElement) ||
  splashTitle === null ||
  labsTitle === null ||
  !(dismissSplashButton instanceof HTMLButtonElement) ||
  !(showSplashButton instanceof HTMLButtonElement) ||
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

setSplashDismissed(getSavedPreference());

dismissSplashButton.addEventListener('click', () => {
  savePreference(hideSplashPreference.checked);
  setSplashDismissed(true);
  labsTitle.focus();
});

showSplashButton.addEventListener('click', () => {
  savePreference(false);
  hideSplashPreference.checked = false;
  setSplashDismissed(false);
  splashTitle.focus();
});
