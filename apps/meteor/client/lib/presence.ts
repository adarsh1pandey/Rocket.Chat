import { Emitter, EventHandlerOf } from '@rocket.chat/emitter';
import { Meteor } from 'meteor/meteor';

import { APIClient } from '../../app/utils/client';
import { IUser } from '../../definition/IUser';
import { UserStatus } from '../../definition/UserStatus';

export const STATUS_MAP = [UserStatus.OFFLINE, UserStatus.ONLINE, UserStatus.AWAY, UserStatus.BUSY];

type InternalEvents = {
	remove: IUser['_id'];
	reset: undefined;
	restart: undefined;
};

type ExternalEvents = {
	[key: string]: UserPresence | undefined;
};

type Events = InternalEvents & ExternalEvents;

const emitter = new Emitter<Events>();

const store = new Map<string, UserPresence>();

export type UserPresence = Readonly<
	Partial<Pick<IUser, 'name' | 'status' | 'utcOffset' | 'statusText' | 'avatarETag' | 'roles' | 'username'>> & Required<Pick<IUser, '_id'>>
>;

type UsersPresencePayload = {
	users: UserPresence[];
	full: boolean;
};

const isUid = (eventType: keyof Events): eventType is UserPresence['_id'] =>
	Boolean(eventType) && typeof eventType === 'string' && !['reset', 'restart', 'remove'].includes(eventType);

const uids = new Set<UserPresence['_id']>();

const update: EventHandlerOf<ExternalEvents, string> = (update) => {
	if (update?._id) {
		store.set(update._id, { ...store.get(update._id), ...update });
		uids.delete(update._id);
	}
};

const notify = (presence: UserPresence): void => {
	if (presence._id) {
		update(presence);
		emitter.emit(presence._id, store.get(presence._id));
	}
};

const getPresence = ((): ((uid: UserPresence['_id']) => void) => {
	let timer: ReturnType<typeof setTimeout>;

	const deletedUids = new Set<UserPresence['_id']>();

	const fetch = (delay = 500): void => {
		timer && clearTimeout(timer);
		timer = setTimeout(async () => {
			const currentUids = new Set(uids);
			uids.clear();

			const ids = Array.from(currentUids);
			const removed = Array.from(deletedUids);

			Meteor.subscribe('stream-user-presence', '', {
				...(ids.length > 0 && { added: Array.from(currentUids) }),
				...(removed.length && { removed: Array.from(deletedUids) }),
			});

			deletedUids.clear();

			if (ids.length === 0) {
				return;
			}

			try {
				const params = {
					ids: [...currentUids],
				};

				const { users } = (await APIClient.v1.get('users.presence', params)) as UsersPresencePayload;

				users.forEach((user) => {
					if (!store.has(user._id)) {
						notify(user);
					}
					currentUids.delete(user._id);
				});

				currentUids.forEach((uid) => {
					notify({ _id: uid, status: UserStatus.OFFLINE });
				});

				currentUids.clear();
			} catch {
				fetch(delay + delay);
			} finally {
				currentUids.forEach((item) => uids.add(item));
			}
		}, delay);
	};

	const get = (uid: UserPresence['_id']): void => {
		uids.add(uid);
		fetch();
	};
	const stop = (uid: UserPresence['_id']): void => {
		deletedUids.add(uid);
		fetch();
	};
	emitter.on('remove', (uid) => {
		if (emitter.has(uid)) {
			return;
		}

		store.delete(uid);
		stop(uid);
	});

	emitter.on('reset', () => {
		emitter
			.events()
			.filter(isUid)
			.forEach((uid) => {
				emitter.emit(uid, undefined);
			});
		emitter.once('restart', () => {
			emitter.events().filter(isUid).forEach(get);
		});
	});

	return get;
})();

const listen = (uid: UserPresence['_id'], handler: EventHandlerOf<ExternalEvents, UserPresence['_id']> | (() => void)): void => {
	if (!uid) {
		return;
	}
	emitter.on(uid, handler);

	const user = store.has(uid) && store.get(uid);
	if (user) {
		return;
	}

	getPresence(uid);
};

const stop = (uid: UserPresence['_id'], handler: EventHandlerOf<ExternalEvents, UserPresence['_id']> | (() => void)): void => {
	setTimeout(() => {
		emitter.off(uid, handler);
		emitter.emit('remove', uid);
	}, 5000);
};

const reset = (): void => {
	store.clear();
	emitter.emit('reset');
};

const restart = (): void => {
	emitter.emit('restart');
};

const get = async (uid: UserPresence['_id']): Promise<UserPresence | undefined> =>
	new Promise((resolve) => {
		const user = store.has(uid) && store.get(uid);
		if (user) {
			return resolve(user);
		}

		const callback: EventHandlerOf<ExternalEvents, UserPresence['_id']> = (args): void => {
			resolve(args);
			stop(uid, callback);
		};
		listen(uid, callback);
	});

export const Presence = {
	listen,
	stop,
	reset,
	restart,
	notify,
	store,
	get,
};
