"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { ApiError } from "@/lib/api";
import {
  billingError,
  getBillingPricing,
  saveBillingPricing,
  type BillingPricing,
} from "@/app/facturacion/billing-api";
import {
  BillingDialog,
  billingAmount,
  billingExchangeRate,
  billingUsdAmount,
} from "@/app/facturacion/billing-presentation";
import styles from "@/app/facturacion/billing.module.css";

function dollarsFromMinor(minor: number) {
  return (minor / 100).toFixed(2);
}

function milliFromRate(value: string) {
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 1000);
}

function minorFromDollars(value: string) {
  const parsed = Number(value.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

export function BillingPricingSettings({ accountId }: { accountId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ pricing: BillingPricing } | { error: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const request = new AbortController();
    getBillingPricing(accountId, request.signal).then(pricing => {
      if (!request.signal.aborted) setResult({ pricing });
    }).catch(failure => {
      if (!request.signal.aborted) {
        setResult({ error: billingError(failure, "No se pudo cargar el precio de membresía. Intenta de nuevo.") });
      }
    });
    return () => request.abort();
  }, [accountId, attempt]);

  const pricing = result && "pricing" in result ? result.pricing : null;

  return (
    <section className={styles.panel} aria-labelledby="billing-pricing-title">
      <div className={styles.panelHeader}>
        <h2 id="billing-pricing-title">Precio y tasa de cambio</h2>
        {pricing && (
          <Button type="button" variant="secondary" aria-haspopup="dialog" onClick={() => { setNotice(""); setEditing(true); }}>
            Editar precio
          </Button>
        )}
      </div>
      {!result && <p className={styles.muted} role="status">Cargando precio…</p>}
      {result && "error" in result && (
        <div className={styles.retry}>
          <p className={styles.error} role="alert">{result.error}</p>
          <Button type="button" variant="secondary" onClick={() => { setResult(null); setAttempt(value => value + 1); }}>
            Reintentar
          </Button>
        </div>
      )}
      {pricing && (
        <dl className={styles.details}>
          <div>
            <dt>Precio por empresa</dt>
            <dd>{billingUsdAmount(pricing.price_usd_minor)} /mes</dd>
          </div>
          <div>
            <dt>Tasa de cambio</dt>
            <dd>1 USD = {billingExchangeRate(pricing.exchange_rate_milli)} DOP</dd>
          </div>
          <div>
            <dt>Equivalente en DOP</dt>
            <dd>{billingAmount(pricing.unit_price_minor)} /empresa</dd>
          </div>
        </dl>
      )}
      {notice && <p className={styles.notice} role="status">{notice}</p>}
      {pricing && editing && (
        <PricingDialog
          accountId={accountId}
          initial={pricing}
          onClose={() => setEditing(false)}
          onReloaded={latest => setResult({ pricing: latest })}
          onSaved={saved => {
            setResult({ pricing: saved });
            setEditing(false);
            setNotice("Precio y tasa guardados.");
          }}
        />
      )}
    </section>
  );
}

function PricingDialog({
  accountId,
  initial,
  onClose,
  onReloaded,
  onSaved,
}: {
  accountId: string;
  initial: BillingPricing;
  onClose: () => void;
  onReloaded: (pricing: BillingPricing) => void;
  onSaved: (pricing: BillingPricing) => void;
}) {
  const [usd, setUsd] = useState(dollarsFromMinor(initial.price_usd_minor));
  const [rate, setRate] = useState(billingExchangeRate(initial.exchange_rate_milli));
  const [invalid, setInvalid] = useState<"usd" | "rate" | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const usdInput = useRef<HTMLInputElement>(null);
  const primaryButton = useRef<HTMLButtonElement>(null);
  const previousConflict = useRef(false);

  const previewUsd = minorFromDollars(usd);
  const previewRate = milliFromRate(rate);
  const previewDop = previewUsd && previewRate
    ? Math.round((previewUsd * previewRate) / 1000)
    : null;

  useEffect(() => {
    if (busy) return;
    if (conflict) primaryButton.current?.focus();
    else if (previousConflict.current) usdInput.current?.focus();
    previousConflict.current = conflict;
  }, [conflict, busy]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || conflict) return;
    const priceUsdMinor = minorFromDollars(usd);
    const exchangeRateMilli = milliFromRate(rate);
    if (!priceUsdMinor) {
      setInvalid("usd");
      setError("");
      usdInput.current?.focus();
      return;
    }
    if (!exchangeRateMilli) {
      setInvalid("rate");
      setError("");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      onSaved(await saveBillingPricing(
        accountId,
        { price_usd_minor: priceUsdMinor, exchange_rate_milli: exchangeRateMilli },
        initial.revision,
      ));
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "BILLING_CONFLICT") setConflict(true);
      else setError(billingError(failure, "No se pudo guardar el precio. Intenta de nuevo."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const latest = await getBillingPricing(accountId);
      setUsd(dollarsFromMinor(latest.price_usd_minor));
      setRate(billingExchangeRate(latest.exchange_rate_milli));
      onReloaded(latest);
      setConflict(false);
    } catch (failure) {
      setError(billingError(failure, "No se pudo recargar el precio. Intenta de nuevo."));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <BillingDialog title="Editar precio y tasa" busy={busy} onClose={onClose}>
      <form className={styles.form} onSubmit={event => void submit(event)} noValidate>
        <p className={styles.muted}>
          El precio se define en USD por empresa. La transferencia se cobra en DOP al tipo de cambio que indiques aquí.
        </p>
        <Input
          ref={usdInput}
          name="price_usd"
          label="Precio por empresa (USD)"
          inputMode="decimal"
          autoComplete="off"
          required
          readOnly={busy || conflict}
          value={usd}
          error={invalid === "usd" ? "Indica un monto en USD mayor que cero." : undefined}
          onChange={event => { setUsd(event.target.value); setInvalid(null); setError(""); }}
        />
        <Input
          name="exchange_rate"
          label="Tasa de cambio (DOP por 1 USD)"
          inputMode="decimal"
          autoComplete="off"
          required
          readOnly={busy || conflict}
          value={rate}
          error={invalid === "rate" ? "Indica una tasa mayor que cero." : undefined}
          onChange={event => { setRate(event.target.value); setInvalid(null); setError(""); }}
        />
        {previewDop !== null && (
          <p className={styles.muted}>Equivalente por empresa: {billingAmount(previewDop)} /mes</p>
        )}
        {conflict && (
          <p className={styles.error} role="alert">
            El precio o la tasa cambiaron mientras los editabas. Recarga los datos para revisar los valores actuales.
          </p>
        )}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Cancelar</Button>
          <Button ref={primaryButton} type={conflict ? "button" : "submit"} loading={busy} onClick={conflict ? () => void reload() : undefined}>
            {conflict ? "Recargar datos" : "Guardar precio"}
          </Button>
        </div>
      </form>
    </BillingDialog>
  );
}
