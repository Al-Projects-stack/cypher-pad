import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, AuthSubmit, AuthSwitch, PasswordField, scorePassword } from '../src/components/AuthCard.js';
import { Landing } from '../src/components/Landing.js';

afterEach(() => {
  cleanup();
});

describe('landing page', () => {
  it('offers create and login paths', () => {
    const onCreate = vi.fn();
    const onLogin = vi.fn();
    render(<Landing onCreate={onCreate} onLogin={onLogin} />);
    fireEvent.click(screen.getByTestId('landing-get-started'));
    fireEvent.click(screen.getByTestId('landing-login'));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Cipherpad')).toBeTruthy();
  });
});

describe('auth card pieces', () => {
  it('disables submit while busy', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<AuthSubmit busy={false} busyText="Working" idleText="Go" testId="go" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('go'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    rerender(<AuthSubmit busy={true} busyText="Working" idleText="Go" testId="go" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('go'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows errors and switch links', () => {
    const onSwitch = vi.fn();
    render(
      <>
        <AuthError message="Wrong password, try again" />
        <AuthSwitch text="No vault yet?" action="Create one" testId="swap" onSwitch={onSwitch} />
      </>
    );
    expect(screen.getByText('Wrong password, try again')).toBeTruthy();
    fireEvent.click(screen.getByTestId('swap'));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });

  it('hides error slot when empty', () => {
    const { container } = render(<AuthError message="" />);
    expect(container.textContent).toBe('');
  });
});

describe('password field', () => {
  it('toggles visibility', () => {
    const onChange = vi.fn();
    render(<PasswordField label="Password" value="secret" testId="pw" autoComplete="current-password" onChange={onChange} />);
    const input = screen.getByTestId('pw') as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByTestId('pw-peek'));
    expect(input.type).toBe('text');
    fireEvent.change(input, { target: { value: 'secret!' } });
    expect(onChange).toHaveBeenCalledWith('secret!');
  });

  it('warns on caps lock', () => {
    render(<PasswordField label="Password" value="A" testId="pw" autoComplete="current-password" onChange={() => undefined} />);
    const input = screen.getByTestId('pw');
    fireEvent.keyUp(input, { key: 'A', shiftKey: false });
    expect(screen.getByText('Caps lock is on')).toBeTruthy();
    fireEvent.keyUp(input, { key: 'a', shiftKey: false });
    expect(screen.queryByText('Caps lock is on')).toBeNull();
  });

  it('scores longer mixed passwords higher', () => {
    expect(scorePassword('abc')).toBeLessThan(scorePassword('correct horse battery staple!'));
    expect(scorePassword('abcdefghijklmnop')).toBeGreaterThan(1);
  });
});
