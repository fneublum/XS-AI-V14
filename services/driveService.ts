// This service is deprecated.
// The application has migrated to Supabase for data persistence.

export const saveToDrive = async (fileName: string, data: any) => {
    console.warn("Google Drive integration has been removed.");
    return false;
};

export const initGapiClient = async () => {
    console.warn("Google Drive integration has been removed.");
};

export const signInToGoogle = async () => {
    console.warn("Google Drive integration has been removed.");
    return false;
};
