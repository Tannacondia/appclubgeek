import { describe, expect, it } from 'vitest';
import { humanizeAuthError, validateMemberRegistration } from './validation';
import { validateGameImage } from './game-images';

const valid = { name: 'Alex García', dni: '30123456', email: 'alex@example.com', password: 'geek1234', confirmation: 'geek1234', terms: true };

describe('validación de registro de socio', () => {
  it('acepta datos completos y válidos', () => expect(validateMemberRegistration(valid)).toBeNull());
  it('rechaza un DNI con formato inválido', () => expect(validateMemberRegistration({ ...valid, dni: '123' })).toMatch(/DNI/));
  it('rechaza un correo con formato inválido', () => expect(validateMemberRegistration({ ...valid, email: 'alex@' })).toMatch(/correo/));
  it('rechaza contraseñas distintas', () => expect(validateMemberRegistration({ ...valid, confirmation: 'otra-clave' })).toMatch(/no coinciden/));
  it('exige aceptar los términos', () => expect(validateMemberRegistration({ ...valid, terms: false })).toMatch(/aceptar/));
  it('traduce las credenciales incorrectas y los duplicados', () => {
    expect(humanizeAuthError('Invalid login credentials')).toBe('Correo o contraseña incorrectos.');
    expect(humanizeAuthError('duplicate key violates unique constraint')).toBe('Ese DNI o correo ya está registrado.');
  });
});

describe('validación de imágenes del catálogo', () => {
  it('acepta JPEG, PNG y WebP de hasta 5 MB', () => {
    expect(validateGameImage({ type: 'image/jpeg', size: 100 } as File)).toBeNull();
    expect(validateGameImage({ type: 'image/png', size: 5 * 1024 * 1024 } as File)).toBeNull();
    expect(validateGameImage({ type: 'image/webp', size: 100 } as File)).toBeNull();
  });
  it('rechaza formatos no permitidos y archivos demasiado grandes', () => {
    expect(validateGameImage({ type: 'image/gif', size: 100 } as File)).toMatch(/JPG, PNG o WebP/);
    expect(validateGameImage({ type: 'image/png', size: 5 * 1024 * 1024 + 1 } as File)).toMatch(/5 MB/);
  });
});
