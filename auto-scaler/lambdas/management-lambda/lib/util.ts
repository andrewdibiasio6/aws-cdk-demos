
export function getCurrentDate(): string {
    //Replace ',' due to failing AWS EKS tag resource calls.
    return new Date().toUTCString().replace(',', '');
}
