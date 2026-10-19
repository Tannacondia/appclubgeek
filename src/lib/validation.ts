export type RegistrationInput = { name: string; dni: string; email: string; password: string; confirmation: string; terms: boolean };

export function validateMemberRegistration(input: RegistrationInput): string | null {
  if (![input.name, input.dni, input.email, input.password, input.confirmation].every((value) => value.trim())) return 'Completá todos los campos obligatorios.';
  if (input.name.trim().length < 2) return 'El nombre debe tener al menos 2 caracteres.';
  if (!/^\d{7,9}$/.test(input.dni.trim())) return 'Ingresá un DNI válido, solo con números (7 a 9 dígitos).';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) return 'Ingresá un correo electrónico válido.';
  if (input.password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (input.password !== input.confirmation) return 'Las contraseñas no coinciden.';
  if (!input.terms) return 'Tenés que aceptar los términos y condiciones.';
  return null;
}

export function humanizeAuthError(message: string): string {
  if (/duplicate key|already registered|unique|database error saving new user/i.test(message)) return 'Ese DNI o correo ya está registrado.';
  if (/invalid login credentials/i.test(message)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(message)) return 'Confirmá tu correo desde el enlace que te enviamos y después iniciá sesión.';
  return message;
}
