"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/arc/input/input";
import { adminRoutes } from "@/lib/admin-navigation";
import { adminErrorMessage, getAdminActivity, userStatuses, type AdminActivity, type AdminActivityPage } from "./admin-api";
import { ActivityHistory, LastActivity } from "./activity-timeline";
import { AdminPagination } from "./admin-pagination";
import adminStyles from "./admin.module.css";
import styles from "./activity.module.css";

type ActivityRequest = { query: string; page: number };
type ActivityResult = { request: ActivityRequest; data: AdminActivityPage } | { request: ActivityRequest; error: string };
type ActivityAccount = AdminActivity & { id: string };

function ActivityList({ users, select }: { users: AdminActivity[]; select: (user: ActivityAccount, trigger: HTMLAnchorElement) => void }) {
  return (
    <div>
      <div className={styles.listHeader} aria-hidden="true">
        <span>Usuario</span><span>Última actividad</span>
      </div>
      <ul className={styles.accountList} role="list">
        {users.map(user => {
          const { id } = user;
          const content = (
            <>
              <span className={styles.identity}>
                <strong>{user.name ?? user.email}</strong>
                {user.name && <span className={styles.secondary}>{user.email}</span>}
                <span className={adminStyles.status}>{userStatuses[user.status]}</span>
              </span>
              <span className={styles.lastActivity}>
                <LastActivity event={user.last_activity} />
                {!id && <span className={styles.secondary}>Sin cuenta vinculada</span>}
              </span>
            </>
          );

          return (
            <li key={id ?? user.email}>
              {id ? (
                <Link href={`${adminRoutes.activity}?${new URLSearchParams({ user: id })}`} className={styles.accountRow} scroll={false}
                  onClick={event => {
                    if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
                      select({ ...user, id }, event.currentTarget);
                    }
                  }}>
                  <span className={styles.screenReaderOnly}>Ver actividad de </span>
                  {content}
                  <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
                </Link>
              ) : <div className={styles.accountRow}>{content}</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ActivityAdministration({ accountId, selectedId }: { accountId: string; selectedId?: string }) {
  const router = useRouter();
  const [request, setRequest] = useState<ActivityRequest>({ query: "", page: 1 });
  const [result, setResult] = useState<ActivityResult | null>(null);
  const [pagination, setPagination] = useState({ perPage: 1, total: 0 });
  const [selectedUser, setSelectedUser] = useState<ActivityAccount | null>(null);
  const trigger = useRef<HTMLAnchorElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousSelection = useRef(selectedId);
  const current = result?.request === request ? result : null;
  const data = current && "data" in current ? current.data : null;
  const user = selectedUser?.id === selectedId ? selectedUser : data?.items.find(item => item.id === selectedId);

  useEffect(() => {
    const controller = new AbortController();
    getAdminActivity(accountId, request.query, request.page, controller.signal).then(data => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(data.total / data.per_page));
      if (request.page > lastPage) {
        setRequest(current => current === request ? { ...request, page: lastPage } : current);
        return;
      }
      setPagination({ perPage: data.per_page, total: data.total });
      setResult({ request, data });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setResult({ request, error: adminErrorMessage(error) });
    });
    return () => controller.abort();
  }, [accountId, request]);

  useEffect(() => {
    const previous = previousSelection.current;
    previousSelection.current = selectedId;
    if (selectedId || !previous) return;
    (trigger.current?.isConnected ? trigger.current : heading.current)?.focus();
    trigger.current = null;
  }, [selectedId]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get("query") ?? "").trim();
    setRequest({ query, page: 1 });
  }

  function refresh() {
    setRequest(current => ({ ...current }));
  }

  return (
    <>
      <section className={`${adminStyles.panel} ${styles.listPanel}`} hidden={Boolean(selectedId)} aria-labelledby="activity-title">
        <div className={adminStyles.header}>
          <h2 id="activity-title" ref={heading} tabIndex={-1}>Actividad de usuarios</h2>
          <Button type="button" variant="secondary" loading={!current} onClick={refresh}>Actualizar</Button>
        </div>
        <form className={styles.filters} role="search" aria-label="Actividad de usuarios" onSubmit={search}>
          <Input label="Buscar por nombre o correo" name="query" type="search" maxLength={200} autoComplete="off" spellCheck={false} />
          <Button type="submit" variant="secondary">Buscar</Button>
        </form>
        {!current && <p className={adminStyles.hint} role="status">Cargando actividad…</p>}
        {current && "error" in current && (
          <div className={adminStyles.retry}>
            <p className={adminStyles.error} role="alert">{current.error}</p>
            <Button type="button" variant="secondary" onClick={refresh}>Reintentar</Button>
          </div>
        )}
        {data && (data.items.length ? <ActivityList users={data.items} select={(user, link) => {
          trigger.current = link;
          setSelectedUser(user);
        }} /> : (
          <p className={adminStyles.hint} role="status">{request.query ? "No se encontraron usuarios." : "No hay usuarios para mostrar."}</p>
        ))}
        <AdminPagination label="Páginas de actividad" page={request.page} {...pagination} disabled={!data} onPage={page => setRequest({ ...request, page })} />
      </section>
      {selectedId && <ActivityHistory key={selectedId} accountId={accountId} userId={selectedId} user={user ?? undefined} onBack={() => {
        if (trigger.current) router.back();
        else router.replace(adminRoutes.activity, { scroll: false });
      }} />}
    </>
  );
}
