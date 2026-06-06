const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const normalizePhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91") && /^91[6-9]/.test(digits)) return digits;
  return digits;
};

export const isValidEmail = (value) => EMAIL_PATTERN.test(String(value || "").trim().toLowerCase());

export const validateEmail = (value) => {
  const email = String(value || "").trim();
  if (!email) return "Email is required";
  if (!isValidEmail(email)) return "Enter a valid email (e.g. name@company.com)";
  return null;
};

export const isValidPhone = (value) => {
  const normalized = normalizePhone(value);
  return /^91[6-9]\d{9}$/.test(normalized);
};

export const validatePhone = (value) => {
  const phone = String(value || "").trim();
  if (!phone) return "Phone number is required";
  if (!isValidPhone(phone)) {
    return "Enter a valid 10-digit Indian mobile (e.g. 9876543210 or +91 9876543210)";
  }
  return null;
};
