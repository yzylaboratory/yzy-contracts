"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { Select } from "@/components/arc/select/select";
import { useToastStack } from "@/components/arc/toast-stack/toast-stack";
import { adminErrorMessage, getAdminUsers, setUserAccess, setUserBilling, userStatuses, type AdminUser, type AdminUsersPage, type UserStatus } from "./admin-api";
import { AdminPagination } from "./admin-pagination";
import styles from "./admin.module.css";

type UsersRequest = { query: string; status: UserStatus | ""; page: number };
type UsersResult = { request: UsersRequest; data: AdminUsersPage } | { request: UsersRequest; error: string };

const usersPerPage = 10;
const statusOptions = [
  { value: "all", label: "Todos" },
  { value: "pending", label: userStatuses.pending },
  { value: "active", label: userStatuses.active },
  { value: "suspended", label: userStatuses.suspended },
];
const dateFormat = new Intl.DateTimeFormat("es-DO", { dateStyle: "medium" });

export function UsersAdministration({ accountId }: { accountId: string }) {
  const { toast } = useToastStack();
  const [request, setRequest] = useState<UsersRequest>({ query: "", status: "", page: 1 });
  const [result, setResult] = useState<UsersResult | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const current = result?.request === request ? result : null;
  const data = current && "data" in current ? current.data : null;
  const items = data?.items;
  const lastData = result && "data" in result && result.request.query === request.query && result.request.status === request.status
    ? result.data
    : null;

  useEffect(() => {
    const controller = new AbortController();
    getAdminUsers(accountId, request.query, request.status, controller.signal, { page: request.page, perPage: usersPerPage })
      .then(data => {
        if (controller.signal.aborted) return;
        const lastPage = Math.max(1, Math.ceil(data.total / data.per_page));
        if (request.page > lastPage) {
          setRequest(current => current === request ? { ...request, page: lastPage } : current);
          return;
        }
        setResult({ request, data });
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setResult({ request, error: adminErrorMessage(error) }); });
    return () => controller.abort();
  }, [accountId, request]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("query") ?? "").trim();
    setRequest(current => ({ ...current, query, page: 1 }));
  }

  function refresh() {
    setRequest(current => ({ ...current }));
  }

  async function changeAccess(user: AdminUser & { id: string }, enabled: boolean) {
    setBusyId(user.id);
    try {
      await setUserAccess(accountId, user.id, enabled);
      refresh();
      toast({ type: "success", title: enabled ? "Acceso habilitado" : "Acceso deshabilitado", description: user.name ?? user.email });
    } catch (error) {
      toast({ type: "error", title: "No se pudo cambiar el acceso", description: adminErrorMessage(error) });
    } finally {
      setBusyId(null);
    }
  }

  async function changeBilling(user: AdminUser & { id: string }, managesBilling: boolean) {
    setBusyId(user.id);
    try {
      await setUserBilling(accountId, user.id, managesBilling);
      refresh();
      toast({
        type: "success",
        title: managesBilling ? "Responsable de facturación asignado" : "Responsable de facturación retirado",
        description: user.name ?? user.email,
      });
    } catch (error) {
      toast({ type: "error", title: "No se pudo cambiar la facturación", description: adminErrorMessage(error) });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="users-title">
      <div className={styles.header}>
        <h2 id="users-title">Acceso de usuarios</h2>
        <Button type="button" variant="secondary" loading={!current} onClick={refresh}>Actualizar</Button>
      </div>
      <p className={styles.hint}>Las personas aparecen aquí al iniciar sesión. Una persona habilitada trabaja con todas las empresas. Marca quiénes son responsables de facturación.</p>
      <form className={styles.filters} role="search" aria-label="Usuarios" onSubmit={search}>
        <Input label="Buscar por nombre o correo" name="query" type="search" maxLength={200} autoComplete="off" spellCheck={false} />
        <Select label="Estado" value={request.status || "all"} options={statusOptions}
          onValueChange={value => setRequest(current => ({ ...current, status: value === "all" ? "" : value as UserStatus, page: 1 }))} />
        <Button type="submit" variant="secondary">Buscar</Button>
      </form>
      {!current && <p className={styles.hint} role="status">Cargando usuarios…</p>}
      {current && "error" in current && (
        <div className={styles.retry}>
          <p className={styles.error} role="alert">{current.error}</p>
          <Button type="button" variant="secondary" onClick={refresh}>Reintentar</Button>
        </div>
      )}
      {items && (items.length ? (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Usuario</th>
                <th scope="col">Estado</th>
                <th scope="col">Registro</th>
                <th scope="col">Facturación</th>
                <th scope="col">Acceso</th>
              </tr>
            </thead>
            <tbody>
              {items.map(user => {
                const { id } = user;
                const enabled = user.status === "active";
                const billingBusy = busyId === id;
                return (
                  <tr key={id ?? user.email}>
                    <th scope="row">
                      <strong>{user.name ?? user.email}</strong>
                      {user.name && <span className={styles.delivery}>{user.email}</span>}
                    </th>
                    <td><span className={styles.status}>{userStatuses[user.status]}</span></td>
                    <td>{dateFormat.format(new Date(user.created_at))}</td>
                    <td>
                      {id ? (
                        <label className={styles.checkbox}>
                          <input
                            type="checkbox"
                            checked={user.manages_billing}
                            disabled={busyId !== null || !enabled}
                            aria-label={`Responsable de facturación: ${user.name ?? user.email}`}
                            onChange={event => void changeBilling({ ...user, id }, event.target.checked)}
                          />
                          Responsable
                        </label>
                      ) : <span className={styles.hint}>Sin cuenta</span>}
                    </td>
                    <td>
                      {id ? (
                        <Button type="button" size="sm" variant={enabled ? "secondary" : "primary"}
                          loading={billingBusy} disabled={busyId !== null && busyId !== id}
                          aria-label={`${enabled ? "Deshabilitar" : "Habilitar"} acceso de ${user.name ?? user.email}`}
                          onClick={() => changeAccess({ ...user, id }, !enabled)}>
                          {enabled ? "Deshabilitar" : "Habilitar"}
                        </Button>
                      ) : <span className={styles.hint}>Sin cuenta</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.hint} role="status">{request.query || request.status ? "No se encontraron usuarios." : "Nadie ha iniciado sesión todavía."}</p>
      ))}
      {lastData && (
        <AdminPagination page={data?.page ?? lastData.page} perPage={lastData.per_page} total={lastData.total}
          onPage={page => setRequest(current => ({ ...current, page }))} label="Paginación de usuarios" disabled={!current} />
      )}
    </section>
  );
}
