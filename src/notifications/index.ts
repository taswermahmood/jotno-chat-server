import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";

import db from "../db";

let expo = new Expo();
let tickets: ExpoPushTicket[] = [];

export const getPushTokens = async (userID: number) => {
    const { rows }: { rows: { push_tokens: string[] }[] } = await db.query(
        "SELECT push_tokens FROM users WHERE id = $1 AND allows_notifications = true",
        [userID]
    );
    if (rows.length > 0) {
        const { push_tokens } = rows[0];

        return push_tokens;
    }
};

export const createMessages = (
    pushTokens: string[],
    body: string,
    chatID: number,
    senderName: string
) => {
    let messages: ExpoPushMessage[] = [];
    for (let token of pushTokens) {
        if (!Expo.isExpoPushToken(token)) {
            console.error(`Push token ${token} is not a valid Expo push token`);
            continue;
        }

        messages.push({
            to: token,
            sound: "default",
            body,
            title: senderName,
            // will need to change url in prod build use process.ENV
            data: {
                url: `exp://192.168.30.24:19000/--/messages/${chatID}/${senderName}`,
            },
        });
    }

    return messages;
};

export const sendNotifications = (messages: ExpoPushMessage[]) => {
    let chunks = expo.chunkPushNotifications(messages);
    (async () => {
        for (let chunk of chunks) {
            try {
                let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
                console.log(ticketChunk);
                tickets.push(...ticketChunk);
            } catch (error) {
                console.error(error);
            }
        }
    })();
};

// Obviously handle this stuff in prod
// set cron job to validate receipts as they come every 30 min
export const validateReceipts = () => {
    let receiptIds = [];
    for (let ticket of tickets) {
        // NOTE: Not all tickets have IDs; for example, tickets for notifications
        // that could not be enqueued will have error information and no receipt ID.
        if ((ticket as any).id) {
            receiptIds.push((ticket as any).id);
        }
    }

    let receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
    (async () => {
        // Like sending notifications, there are different strategies you could use
        // to retrieve batches of receipts from the Expo service.
        for (let chunk of receiptIdChunks) {
            try {
                let receipts = await expo.getPushNotificationReceiptsAsync(chunk);
                console.log(receipts);

                // The receipts specify whether Apple or Google successfully received the
                // notification and information about an error, if one occurred.
                for (let receiptId in receipts) {
                    let { status, details } = receipts[receiptId];
                    if (status === "ok") {
                        continue;
                    } else if (status === "error") {
                        console.error(`There was an error sending a notification`);
                        if (details && (details as any).error) {
                            console.error(`The error code is ${(details as any).error}`);
                        }
                    }
                }
            } catch (error) {
                console.error(error);
            }
        }
    })();
};