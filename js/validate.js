const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@(gmail\.com|mail\.ru|yahoo\.com|yahoo\.co\.uk|outlook\.com|outlook\.co\.uk|hotmail\.com|live\.com)$/i;
const PASSWORD_MIN_LENGTH = 8;

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(item => item.classList.remove('active'));
    tabContents.forEach(item => item.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`${btn.dataset.tab}Form`).classList.add('active');
  });
});

function setError(element, message) {
  element.textContent = message;
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function validateEmail(input, error) {
  const value = normalizeEmail(input.value);
  if (!value) {
    setError(error, 'Введите email');
    return false;
  }
  if (!EMAIL_REGEX.test(value)) {
    setError(error, 'Разрешены Gmail, Mail.ru, Yahoo и Outlook');
    return false;
  }
  setError(error, '');
  return true;
}

function validatePassword(input, error, strict = true) {
  const value = input.value;
  if (value.length < 6) {
    setError(error, 'Минимум 6 символов');
    return false;
  }
  if (strict && value.length < PASSWORD_MIN_LENGTH) {
    setError(error, `Минимум ${PASSWORD_MIN_LENGTH} символов`);
    return false;
  }
  if (strict && !/[a-z]/.test(value)) {
    setError(error, 'Добавьте строчную латинскую букву');
    return false;
  }
  if (strict && !/[A-Z]/.test(value)) {
    setError(error, 'Добавьте заглавную латинскую букву');
    return false;
  }
  if (strict && !/\d/.test(value)) {
    setError(error, 'Добавьте хотя бы одну цифру');
    return false;
  }
  setError(error, '');
  return true;
}

function showMessage(message, type = 'error') {
  const box = document.getElementById('serverMsg');
  box.textContent = message;
  box.className = `msg show ${type}-msg`;
}

function getCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const item = document.cookie.split('; ').find(cookie => cookie.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : '';
}

const loginForm = document.getElementById('loginForm');
loginForm.addEventListener('submit', event => {
  const emailOk = validateEmail(document.getElementById('loginEmail'), document.getElementById('loginEmailError'));
  const passwordOk = validatePassword(document.getElementById('loginPassword'), document.getElementById('loginPasswordError'), false);
  if (!emailOk || !passwordOk) {
    event.preventDefault();
  }
});

const registerForm = document.getElementById('registerForm');
const registrationEmailInput = document.getElementById('regEmail');
const registrationEmailError = document.getElementById('regEmailError');

registrationEmailInput.addEventListener('input', () => {
  const email = normalizeEmail(registrationEmailInput.value);
  if (!EMAIL_REGEX.test(email)) {
    validateEmail(registrationEmailInput, registrationEmailError);
    return;
  }

  fetch(`/api/check-email?email=${encodeURIComponent(email)}`)
    .then(response => response.json())
    .then(result => {
      if (normalizeEmail(registrationEmailInput.value) !== email) return;
      setError(registrationEmailError, result.exists ? 'Этот email уже зарегистрирован' : '');
    })
    .catch(() => setError(registrationEmailError, 'Не удалось проверить email'));
});

registerForm.addEventListener('submit', event => {
  const name = document.getElementById('regName');
  const nameOk = name.value.trim().length >= 2;
  setError(document.getElementById('regNameError'), nameOk ? '' : 'Введите имя (минимум 2 символа)');

  const emailOk = validateEmail(registrationEmailInput, registrationEmailError);
  const password = document.getElementById('regPassword');
  const passwordOk = validatePassword(password, document.getElementById('regPasswordError'));
  const password2 = document.getElementById('regPassword2');
  const passwordsMatch = password2.value === password.value && password2.value.length >= PASSWORD_MIN_LENGTH;
  setError(document.getElementById('regPassword2Error'), passwordsMatch ? '' : 'Пароли не совпадают');

  if (!nameOk || !emailOk || !passwordOk || !passwordsMatch) {
    event.preventDefault();
  }
});

window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const loggedOut = params.get('loggedOut') === '1';
  const message = params.get('msg');
  const type = params.get('type');

  if (loggedOut) {
    sessionStorage.removeItem('oa_tab_session');
  } else if (sessionStorage.getItem('oa_tab_session') === '1') {
    fetch('/api/me')
      .then(response => {
        if (response.ok) {
          window.location.replace('/dashboard.html');
        } else {
          sessionStorage.removeItem('oa_tab_session');
        }
      })
      .catch(() => sessionStorage.removeItem('oa_tab_session'));
  }

  if (message) {
    showMessage(message, type === 'success' ? 'success' : 'error');
    if (type === 'success') {
      document.querySelector('.tab-btn[data-tab="login"]').click();
    }
  }

  const rememberedEmail = getCookie('oa_remember_email');
  if (rememberedEmail) {
    document.getElementById('loginEmail').value = rememberedEmail;
    document.querySelector('input[name="remember"]').checked = true;
  }
});
